/**
 * Embed layout — minimal chrome, no sidebar or nav.
 * Used for Halo PSA iframe tabs and other external embeds.
 */
export default function EmbedLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>TriageIT</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
              body { background: #09090b; color: #fafafa; }
              scrollbar-width: thin; scrollbar-color: #27272a transparent;
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
