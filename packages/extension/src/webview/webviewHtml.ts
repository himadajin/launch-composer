export function rewriteWebviewHtml(
  html: string,
  toWebviewUri: (assetPath: string) => string,
): string {
  const replacedScripts = html.replace(
    /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
    (_match, src: string) =>
      `<script type="module" src="${toWebviewUri(src)}"></script>`,
  );

  return replacedScripts.replace(
    /<link rel="stylesheet" crossorigin href="([^"]+)"\s*\/?>/g,
    (_match, href: string) =>
      `<link rel="stylesheet" href="${toWebviewUri(href)}">`,
  );
}
