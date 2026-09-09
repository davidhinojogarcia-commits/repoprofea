import sharp from 'sharp';
import fs from 'fs';

async function generatePerfectLogo() {
  const resSvg = await fetch('https://upload.wikimedia.org/wikipedia/commons/7/76/Logodipucadiz.svg', { 
    headers: { 'User-Agent': 'Mozilla/5.0' } 
  });
  
  if (!resSvg.ok) {
    throw new Error('Failed to download official vector logo');
  }

  const svgText = await resSvg.text();
  const matches = Array.from(svgText.matchAll(/<path[^>]*d=\"([^\"]+)\"[^>]*>/g)).map(m => m[1]);
  
  if (matches.length < 32) {
    throw new Error('Unexpected SVG path structure');
  }

  // Path 0: Emblem outer shape
  // Path 1: Emblem inner triangle (#FDFDFE)
  const emblemOuter = matches[0];
  const emblemInner = matches[1];

  // Path 2..23: Letter outer shapes
  const letterOuter = matches.slice(2, 24).join(' ');
  // Path 24..31: Letter inner counters (#FFFFFF)
  const letterInner = matches.slice(24).join(' ');

  // 1. LIGHT MODE SVG (Hollow paths, transparent holes, dark text & blue emblem)
  const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 132" width="1720" height="264">
  <defs>
    <style>
      .coop-title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 29px; fill: #004B87; font-weight: 700; letter-spacing: 5px; }
      .coop-sub { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 25px; fill: #4C5860; font-weight: 300; letter-spacing: 0.5px; }
      .coop-profea { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 25px; fill: #4C5860; font-weight: 300; letter-spacing: 2.5px; }
    </style>
  </defs>

  <g transform="translate(0, 1.5)">
    <!-- Emblem (Hollow - inner triangle subtracts from outer) -->
    <path fill-rule="evenodd" clip-rule="evenodd" fill="#004B87" d="${emblemOuter} ${emblemInner}" />
    <!-- Lettering (Hollow - inner letter holes subtract from letter bodies) -->
    <path fill-rule="evenodd" clip-rule="evenodd" fill="#4C5860" d="${letterOuter} ${letterInner}" />
  </g>

  <!-- Middle Separator Bar -->
  <line x1="462" y1="6" x2="462" y2="124" stroke="#004B87" stroke-width="2.5" />

  <!-- Right side text -->
  <text x="492" y="36" class="coop-title">COOPERACIÓN</text>
  <text x="492" y="76" class="coop-sub">Gestión de Fondos</text>
  <text x="492" y="112" class="coop-profea">PROFEA</text>
</svg>`;

  // 2. DARK MODE SVG (Hollow paths, transparent holes, vibrant blue emblem & light text)
  const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 132" width="1720" height="264">
  <defs>
    <style>
      .coop-title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 29px; fill: #38BDF8; font-weight: 700; letter-spacing: 5px; }
      .coop-sub { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 25px; fill: #F1F5F9; font-weight: 300; letter-spacing: 0.5px; }
      .coop-profea { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 25px; fill: #CBD5E1; font-weight: 300; letter-spacing: 2.5px; }
    </style>
  </defs>

  <g transform="translate(0, 1.5)">
    <!-- Emblem (Hollow - vibrant blue) -->
    <path fill-rule="evenodd" clip-rule="evenodd" fill="#38BDF8" d="${emblemOuter} ${emblemInner}" />
    <!-- Lettering (Hollow - crisp white/slate) -->
    <path fill-rule="evenodd" clip-rule="evenodd" fill="#F1F5F9" d="${letterOuter} ${letterInner}" />
  </g>

  <!-- Middle Separator Bar -->
  <line x1="462" y1="6" x2="462" y2="124" stroke="#38BDF8" stroke-width="2.5" />

  <!-- Right side text -->
  <text x="492" y="36" class="coop-title">COOPERACIÓN</text>
  <text x="492" y="76" class="coop-sub">Gestión de Fondos</text>
  <text x="492" y="112" class="coop-profea">PROFEA</text>
</svg>`;

  // Write SVGs to public
  fs.writeFileSync('./public/logo-diputacion-profea.svg', lightSvg);
  fs.writeFileSync('./public/logo-diputacion-profea-dark.svg', darkSvg);

  // Generate PNGs using Sharp
  const lightPngBuffer = await sharp(Buffer.from(lightSvg))
    .resize(1720, 264, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ quality: 100 })
    .toBuffer();

  const darkPngBuffer = await sharp(Buffer.from(darkSvg))
    .resize(1720, 264, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('./public/logo-diputacion-profea.png', lightPngBuffer);
  fs.writeFileSync('./public/logo.png', lightPngBuffer);
  fs.writeFileSync('./public/logo-diputacion-profea-dark.png', darkPngBuffer);

  // White background PNG for PDFs
  const pdfPngBuffer = await sharp(Buffer.from(lightSvg))
    .resize(1720, 264, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('./public/logo-pdf.png', pdfPngBuffer);

  // Base64 Data TS export
  const base64Data = `data:image/png;base64,${pdfPngBuffer.toString('base64')}`;
  const base64TsContent = `// Base64 encoded official logo: Diputación de Cádiz - COOPERACIÓN Gestión de Fondos PROFEA
export const OFFICIAL_LOGO_BASE64 = "${base64Data}";
export const LOGO_ASSET_URL = "/logo-diputacion-profea.svg";
export const LOGO_DARK_ASSET_URL = "/logo-diputacion-profea-dark.svg";
`;
  fs.writeFileSync('./src/assets/logoData.ts', base64TsContent);

  console.log('✅ Light & Dark pixel-perfect hollow vector logos generated successfully!');
}

generatePerfectLogo().catch(console.error);
