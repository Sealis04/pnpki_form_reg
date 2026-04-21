import PdfFormFiller from "~/components/PdfFormFiller";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
          DICT-PNPKI-FO-001 · Version 5. Revised May 2025
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          PNPKI Individual Certificate Form
        </h1>
        <p className="text-sm text-slate-600">
          Fill out the PNPKI subscriber form entirely in your browser. Your
          inputs, signatures, and the generated PDF never leave this device.
        </p>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="mb-1 font-semibold text-slate-700">Instructions</p>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>Please complete the form using BLOCK LETTERS ONLY.</li>
            <li>All fields are required for successful submission.</li>
            <li>
              Any discrepancy or inconsistency in the information provided may
              result in delays or denial of the application.
            </li>
            <li>Tick the box that corresponds to your answer.</li>
            <li>Do NOT input acronyms or abbreviated information.</li>
          </ol>
        </div>
      </header>
      <PdfFormFiller />
      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
        Built with Next.js 15 · React 19 · pdf-lib · signature_pad. Static
        export, deployable to GitHub Pages.
      </footer>
    </main>
  );
}
