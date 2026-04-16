import PdfFormFiller from "~/components/PdfFormFiller";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          PNPKI Form Registration
        </h1>
        <p className="text-slate-600">
          Fill out the PNPKI subscriber form entirely in your browser. Your
          inputs, signatures, and the generated PDF never leave this device.
        </p>
      </header>
      <PdfFormFiller />
      <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500">
        Built with Next.js 15 · React 19 · pdf-lib · signature_pad. Static
        export, deployable to GitHub Pages.
      </footer>
    </main>
  );
}
