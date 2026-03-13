# kelgibooth (iPad Photobooth)

Static frontend (HTML/CSS/JS) + optional Vercel backend endpoints for:

- **Email** (Resend)

## Deploy to Vercel

1. Put the contents of this folder at your repo root **or** set Vercel **Root Directory** to `photobooth/`.
2. Import the GitHub repo into Vercel and deploy.

## Email (Resend)

Resend has a free tier and is the simplest “API email” setup.

### 1) Resend setup

- Create an account at Resend
- Verify a domain (recommended) or use their onboarding sender where allowed
- Create an API key

### 2) Vercel Environment Variables

- `RESEND_API_KEY` = your Resend API key
- `EMAIL_FROM` = e.g. `Kelgi Booth <booth@yourdomain.com>`

### 3) Endpoint

- `POST /api/email` with JSON `{ email, filename, dataUrl }`

## Local dev

You can run the static site locally:

```bash
cd photobooth
python3 -m http.server 8080
```

Notes:

- Camera access typically requires **HTTPS**, but localhost is usually allowed.
- On iPad, use the deployed Vercel HTTPS URL for reliable camera access.

