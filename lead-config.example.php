<?php
return [
  'smtp_host' => 'smtp.zoho.com',
  'smtp_port' => 587,
  'smtp_user' => 'hello@echofourai.com',
  'smtp_pass' => 'replace-with-zoho-app-password',
  'from_email' => 'hello@echofourai.com',
  'from_name' => 'EchoFour AI',
  'to_email' => 'hello@echofourai.com',
  'rate_limit_note' => 'lead.php allows 5 submissions per IP per 60 seconds and rejects oversized, too-fast, and stale form posts.',
  'allowed_origins' => [
    'https://echofourai.com',
    'https://www.echofourai.com'
  ]
];
