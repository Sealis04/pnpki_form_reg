# PNPKI Form Registration (client-side)

A client-only Next.js + React + TypeScript app (T3-style minus the server
pieces, since everything runs in the browser) that lets a user fill a PDF form
— including drawing signatures — entirely on their device. No data leaves the
browser; the PDF is parsed, filled, and re-saved locally with `pdf-lib`.

Deployable as a static export to **GitHub Pages**.

## Stack

- **Next.js 15** (App Router, static export via `output: "export"`)
- **React 19**
- **TypeScript 5.7**
- **Tailwind CSS 3.4**
- **pdf-lib** — reads, fills, and flattens the PDF AcroForm
- **signature_pad** — captures handwritten signatures from mouse / touch / stylus
- **zod** — available for client-side validation

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### Using the PNPKI form

1. Download the fillable PNPKI subscriber form (the one you linked from Google
   Drive).
2. Place it at **`public/form.pdf`**.
3. Reload the page — the form's fields are auto-detected and rendered as
   inputs, and any signature fields get a signature pad.
4. Fill everything in, click **Generate & download filled PDF**, and the
   completed PDF is saved to your downloads.

You can also upload any other AcroForm-enabled PDF at runtime; the app will
render inputs for its fields.

### How signatures work

- Fields whose type is a PDF `Sig` widget are always rendered as signature
  pads.
- Text fields whose name contains `signature`, `signatory`, `sign`, or
  `initial` are also treated as signature pads (many agencies name their
  "signature over printed name" field as a text box, not a true signature
  widget).
- On generate, the drawn signature PNG is embedded into the widget's rectangle
  on the right page, the field is removed, and the form is flattened so the
  output is a static, uneditable copy.

## Deploy to GitHub Pages

This repo ships with `.github/workflows/deploy.yml`. To enable:

1. In GitHub, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
2. Push to `main`. The workflow builds a static export and publishes `./out`.
3. The site will be served at `https://<user>.github.io/pnpki_form_reg/`.

The `basePath` is set to `/pnpki_form_reg` in production via
`next.config.mjs`. If you fork this repo under a different name, override it
with the `NEXT_PUBLIC_BASE_PATH` env var at build time.

## Privacy

Everything — PDF parsing, filling, signatures, PDF re-save — happens in the
browser. There is no server component in this app. No data is uploaded
anywhere; the final PDF is generated with a `Blob` URL and triggered as a
download.
