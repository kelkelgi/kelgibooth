import { Resend } from 'resend';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid dataUrl');
  const mimeType = m[1];
  const base64 = m[2];
  return { mimeType, base64 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { email, filename, dataUrl } = req.body || {};
    if (!email || !filename || !dataUrl) {
      return json(res, 400, { error: 'email, filename, dataUrl required' });
    }

    const apiKey = requireEnv('RESEND_API_KEY');
    const from = requireEnv('EMAIL_FROM'); // e.g. "Kelgi Booth <booth@yourdomain.com>"

    const resend = new Resend(apiKey);
    const { mimeType, base64 } = parseDataUrl(dataUrl);

    await resend.emails.send({
      from,
      to: email,
      subject: 'Your photobooth strip',
      html: '<p>Thanks for stopping by! Your photobooth strip is attached.</p>',
      attachments: [
        {
          filename,
          content: base64,
          type: mimeType,
        },
      ],
    });

    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Email failed' });
  }
}

