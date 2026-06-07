<?php
declare(strict_types=1);

$configPath = __DIR__ . '/lead-config.php';
const BODY_LIMIT_BYTES = 12288;
const MIN_FORM_SECONDS = 2;
const MAX_FORM_MINUTES = 120;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 5;

function set_security_headers(): void {
  header('X-Content-Type-Options: nosniff');
  header('X-Frame-Options: DENY');
  header('Referrer-Policy: strict-origin-when-cross-origin');
  header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()');
  header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  header('Cache-Control: no-store');
}

function respond(int $status, array $payload): void {
  http_response_code($status);
  header('Content-Type: application/json');
  if ($status !== 204) {
    echo json_encode($payload);
  }
  exit;
}

function clean_value($value, int $maxLength = 320): string {
  $text = preg_replace('/[\x00-\x1F\x7F]/', ' ', (string) $value);
  $text = preg_replace('/\s+/', ' ', trim($text));
  if (function_exists('mb_substr')) {
    return mb_substr($text, 0, $maxLength, 'UTF-8');
  }
  return substr($text, 0, $maxLength);
}

function get_client_key(): string {
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  return hash('sha256', $ip);
}

function enforce_rate_limit(): void {
  $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'echofour-lead-rate';
  if (!is_dir($dir)) {
    mkdir($dir, 0700, true);
  }

  $file = $dir . DIRECTORY_SEPARATOR . get_client_key() . '.json';
  $now = time();
  $state = ['count' => 0, 'resetAt' => $now + RATE_LIMIT_WINDOW_SECONDS];

  $handle = fopen($file, 'c+');
  if (!$handle) {
    respond(429, ['error' => 'Please try again shortly.']);
  }

  flock($handle, LOCK_EX);
  $contents = stream_get_contents($handle);
  $decoded = json_decode($contents ?: '{}', true);
  if (is_array($decoded) && isset($decoded['count'], $decoded['resetAt']) && (int) $decoded['resetAt'] > $now) {
    $state = ['count' => (int) $decoded['count'], 'resetAt' => (int) $decoded['resetAt']];
  }

  $state['count'] += 1;
  if ($state['count'] > RATE_LIMIT_MAX) {
    header('Retry-After: ' . max(1, $state['resetAt'] - $now));
    flock($handle, LOCK_UN);
    fclose($handle);
    respond(429, ['error' => 'Too many requests. Please try again shortly.']);
  }

  ftruncate($handle, 0);
  rewind($handle);
  fwrite($handle, json_encode($state));
  fflush($handle);
  flock($handle, LOCK_UN);
  fclose($handle);
}

function validate_config(array $config): void {
  $required = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'from_email', 'from_name', 'to_email', 'allowed_origins'];
  foreach ($required as $key) {
    if (!isset($config[$key]) || $config[$key] === '' || $config[$key] === 'replace-with-zoho-app-password') {
      respond(500, ['error' => 'Lead email is not configured.']);
    }
  }

  if (!filter_var($config['from_email'], FILTER_VALIDATE_EMAIL) || !filter_var($config['to_email'], FILTER_VALIDATE_EMAIL)) {
    respond(500, ['error' => 'Lead email is not configured.']);
  }
}

function smtp_read($socket): string {
  $response = '';

  while (($line = fgets($socket, 515)) !== false) {
    $response .= $line;
    if (strlen($line) >= 4 && $line[3] === ' ') break;
  }

  return $response;
}

function smtp_command($socket, string $command, array $expected): string {
  fwrite($socket, $command . "\r\n");
  $response = smtp_read($socket);
  $code = (int) substr($response, 0, 3);

  if (!in_array($code, $expected, true)) {
    throw new RuntimeException('SMTP command failed: ' . $code);
  }

  return $response;
}

function smtp_send(array $config, string $subject, string $body, string $replyTo = ''): void {
  $host = $config['smtp_host'];
  $port = (int) $config['smtp_port'];
  $context = stream_context_create([
    'ssl' => [
      'verify_peer' => true,
      'verify_peer_name' => true,
      'peer_name' => $host,
      'SNI_enabled' => true,
    ],
  ]);
  $socket = stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $context);

  if (!$socket) {
    throw new RuntimeException('SMTP connection failed.');
  }

  stream_set_timeout($socket, 20);
  $greeting = smtp_read($socket);
  if ((int) substr($greeting, 0, 3) !== 220) {
    throw new RuntimeException('SMTP greeting failed.');
  }

  smtp_command($socket, 'EHLO echofourai.com', [250]);
  smtp_command($socket, 'STARTTLS', [220]);

  if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
    throw new RuntimeException('SMTP TLS negotiation failed.');
  }

  smtp_command($socket, 'EHLO echofourai.com', [250]);
  smtp_command($socket, 'AUTH LOGIN', [334]);
  smtp_command($socket, base64_encode($config['smtp_user']), [334]);
  smtp_command($socket, base64_encode($config['smtp_pass']), [235]);
  smtp_command($socket, 'MAIL FROM:<' . $config['from_email'] . '>', [250]);
  smtp_command($socket, 'RCPT TO:<' . $config['to_email'] . '>', [250, 251]);
  smtp_command($socket, 'DATA', [354]);

  $headers = [
    'From: ' . $config['from_name'] . ' <' . $config['from_email'] . '>',
    'To: ' . $config['to_email'],
    'Subject: ' . $subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
  ];

  if ($replyTo) {
    $headers[] = 'Reply-To: ' . $replyTo;
  }

  $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;
  $message = str_replace("\n.", "\n..", $message);
  fwrite($socket, $message . "\r\n.\r\n");
  $response = smtp_read($socket);
  if ((int) substr($response, 0, 3) !== 250) {
    throw new RuntimeException('SMTP message send failed.');
  }

  smtp_command($socket, 'QUIT', [221]);
  fclose($socket);
}

set_security_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  respond(204, []);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  respond(405, ['error' => 'Method not allowed.']);
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > BODY_LIMIT_BYTES) {
  respond(413, ['error' => 'Request is too large.']);
}

if (!file_exists($configPath)) {
  respond(500, ['error' => 'Lead email is not configured.']);
}

$config = require $configPath;
if (!is_array($config)) {
  respond(500, ['error' => 'Lead email is not configured.']);
}
validate_config($config);

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $config['allowed_origins'] ?? [], true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
} elseif ($origin) {
  respond(403, ['error' => 'Origin not allowed.']);
}

enforce_rate_limit();

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '{}', true);
if (!is_array($input)) {
  respond(400, ['error' => 'Invalid request.']);
}

if (!empty($input['website'])) {
  respond(204, []);
}

$name = clean_value($input['name'] ?? '', 160);
$email = clean_value($input['email'] ?? '', 160);
$business = clean_value($input['business'] ?? '', 220);
$workflow = clean_value($input['workflow'] ?? '', 320);
$consent = ($input['privacyConsent'] ?? '') === 'on' || ($input['privacyConsent'] ?? false) === true;
$startedAt = (float) ($input['startedAt'] ?? 0);
$elapsedMs = (microtime(true) * 1000) - $startedAt;

if (!$name || !$email || !$business || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
  respond(400, ['error' => 'Valid name, email, and business type are required.']);
}

if (!$startedAt || $elapsedMs < MIN_FORM_SECONDS * 1000 || $elapsedMs > MAX_FORM_MINUTES * 60 * 1000) {
  respond(400, ['error' => 'Please refresh the page and try again.']);
}

if (!$consent) {
  respond(400, ['error' => 'Privacy consent is required.']);
}

$body = implode("\n", array_filter([
  'New EchoFour AI consultation request',
  '',
  'Name: ' . $name,
  'Email: ' . $email,
  'Business type: ' . $business,
  $workflow ? 'Workflow: ' . $workflow : '',
  'Source: contact-form',
  'Received at: ' . gmdate('c')
]));

try {
  smtp_send($config, 'New EchoFour AI consultation request', $body, $email);
  respond(200, ['ok' => true]);
} catch (Throwable $error) {
  error_log('Lead notification email failed: ' . $error->getMessage());
  respond(500, ['error' => 'Email notification failed.']);
}
