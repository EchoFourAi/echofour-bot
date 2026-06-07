<?php
declare(strict_types=1);

$configPath = __DIR__ . '/lead-config.php';

function respond(int $status, array $payload): void {
  http_response_code($status);
  header('Content-Type: application/json');
  echo json_encode($payload);
  exit;
}

function clean_value($value, int $maxLength = 320): string {
  $text = preg_replace('/[\x00-\x1F\x7F]/', ' ', (string) $value);
  $text = preg_replace('/\s+/', ' ', trim($text));
  return substr($text, 0, $maxLength);
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
  $socket = stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20);

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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  respond(204, []);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  respond(405, ['error' => 'Method not allowed.']);
}

if (!file_exists($configPath)) {
  respond(500, ['error' => 'Lead email is not configured.']);
}

$config = require $configPath;
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $config['allowed_origins'] ?? [], true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
}

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '{}', true);
if (!is_array($input)) {
  respond(400, ['error' => 'Invalid request.']);
}

if (!empty($input['website'])) {
  respond(200, ['ok' => true]);
}

$name = clean_value($input['name'] ?? '', 160);
$email = clean_value($input['email'] ?? '', 160);
$business = clean_value($input['business'] ?? '', 220);
$workflow = clean_value($input['workflow'] ?? '', 320);
$consent = ($input['privacyConsent'] ?? '') === 'on' || ($input['privacyConsent'] ?? false) === true;

if (!$name || !$email || !$business || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
  respond(400, ['error' => 'Valid name, email, and business type are required.']);
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
