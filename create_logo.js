import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Ensure public and src/assets directories exist
if (!fs.existsSync('./public')) {
  fs.mkdirSync('./public', { recursive: true });
}
if (!fs.existsSync('./src/assets')) {
  fs.mkdirSync('./src/assets', { recursive: true });
}

// SVG matching the exact Diputación de Cádiz - COOPERACIÓN Gestión de Fondos PROFEA logo
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 300" width="960" height="300">
  <style>
    .dipu-text { font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif; font-size: 64px; fill: #4A4D4E; font-weight: 300; }
    .dipu-text-bold { font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif; font-size: 64px; fill: #4A4D4E; font-weight: 400; }
    .coop-title { font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif; font-size: 42px; fill: #004B87; font-weight: 500; letter-spacing: 7px; }
    .coop-sub { font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif; font-size: 38px; fill: #4A4D4E; font-weight: 300; letter-spacing: 0.5px; }
    .coop-profea { font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif; font-size: 38px; fill: #4A4D4E; font-weight: 300; letter-spacing: 2px; }
  </style>

  <!-- DIPUTACION DE CADIZ LOGO EMBLEM (Exact Vector Silhouette) -->
  <g transform="translate(0, 10)">
    <!-- Outer Blue Ribbon Band -->
    <path d="M 0,182 L 115,182 C 145,182 170,165 190,140 L 210,110 C 220,95 220,70 205,55 L 180,30 C 165,15 140,15 125,30 L 100,55 C 85,70 85,95 100,110 L 155,180 C 175,205 200,218 230,218 L 230,190 C 210,190 190,180 175,160 L 120,90 C 112,80 112,65 120,55 L 140,35 C 148,27 160,27 168,35 L 190,58 C 198,66 198,80 190,90 L 172,112 L 150,140 C 135,160 115,170 90,170 L 0,170 Z" fill="#004B87"/>
    
    <!-- Lower Horizontal Band -->
    <path d="M 0,215 L 130,215 C 160,215 185,200 205,175 L 215,162 L 195,145 L 185,158 C 170,178 150,188 125,188 L 0,188 Z" fill="#004B87"/>

    <!-- Top Frame Bar -->
    <path d="M 70,25 L 230,25 L 230,45 L 70,45 Z" fill="#004B87"/>
    
    <!-- Inner Triangular Shield Cutout -->
    <path d="M 90,52 L 210,52 L 150,142 Z" fill="none" stroke="#004B87" stroke-width="14" stroke-linejoin="miter"/>
  </g>

  <!-- TEXT: Diputación de Cádiz -->
  <text x="260" y="98" class="dipu-text">Diputación</text>
  <text x="260" y="172" class="dipu-text-bold">de Cádiz</text>

  <!-- VERTICAL DIVIDER LINE -->
  <line x1="628" y1="15" x2="628" y2="285" stroke="#004B87" stroke-width="3"/>

  <!-- TEXT: COOPERACIÓN / Gestión de Fondos / PROFEA -->
  <text x="668" y="62" class="coop-title">COOPERACIÓN</text>
  <text x="668" y="132" class="coop-sub">Gestión de Fondos</text>
  <text x="668" y="198" class="coop-profea">PROFEA</text>
</svg>`;

fs.writeFileSync('./public/logo-diputacion-profea.svg', svgContent);

// Generate crisp PNG versions using sharp
async function buildImages() {
  const svgBuffer = Buffer.from(svgContent);

  // High quality PNG for web & PDF exports (1200x375)
  const png1200 = await sharp(svgBuffer)
    .resize(1200, 375, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('./public/logo-diputacion-profea.png', png1200);
  fs.writeFileSync('./public/logo.png', png1200);

  // White background PNG version for PDFs to ensure crisp rendering on jsPDF without alpha artifacting
  const pdfPng = await sharp(svgBuffer)
    .resize(1200, 375, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('./public/logo-pdf.png', pdfPng);

  // Create base64 TS file for instant offline PDF generation
  const base64Data = `data:image/png;base64,${pdfPng.toString('base64')}`;
  const base64TsContent = `// Base64 encoded official logo: Diputación de Cádiz - COOPERACIÓN Gestión de Fondos PROFEA
export const OFFICIAL_LOGO_BASE64 = "${base64Data}";
export const LOGO_ASSET_URL = "/logo-diputacion-profea.png";
`;
  fs.writeFileSync('./src/assets/logoData.ts', base64TsContent);

  console.log('Logo generated successfully!');
}

buildImages().catch(console.error);
