// Copia as fontes do app (as mesmas do app de Windows) para www/fonts, para funcionarem offline.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const arquivos = [
  ['bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-700-normal.woff2'],
  ['dm-mono', 'dm-mono-latin-500-normal.woff2']
];
mkdirSync('www/fonts', { recursive: true });
let faltando = 0;
for (const [pacote, arquivo] of arquivos) {
  const origem = `node_modules/@fontsource/${pacote}/files/${arquivo}`;
  if (existsSync(origem)) copyFileSync(origem, `www/fonts/${arquivo}`);
  else { faltando++; console.warn('Fonte não encontrada (usa a fonte do sistema):', origem); }
}
console.log(`Fontes copiadas: ${arquivos.length - faltando}/${arquivos.length}`);
