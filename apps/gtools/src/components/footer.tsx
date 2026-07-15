export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-10 text-sm text-fog sm:flex-row">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <p>
            Gamma Tech Services LLC · Naples, FL ·{" "}
            <a
              href="https://gamma.tech"
              className="underline decoration-line underline-offset-4 transition-colors hover:text-snow"
            >
              gamma.tech
            </a>
          </p>
          {/* Echo of the suite-grid's ghost card (owner request: "and many
              more to come") — same vibe, quieter register, so it reads as a
              closing note rather than a repeat. */}
          <p className="text-xs text-fog/70">
            Eleven tools today — many more to come.
          </p>
        </div>

        <a
          href="mailto:help@gamma.tech"
          className="transition-colors hover:text-snow"
        >
          help@gamma.tech
        </a>
      </div>
    </footer>
  );
}
