import React, { useState, useRef } from 'react';
import { 
  Camera, 
  Trash2, 
  FileText, 
  Plus, 
  X, 
  ArrowLeft, 
  ArrowRight, 
  Download, 
  Share2, 
  Image as ImageIcon, 
  FileDown, 
  Check, 
  RefreshCw, 
  Loader2, 
  AlertCircle,
  Eye,
  Sparkles,
  FileSpreadsheet,
  DownloadCloud,
  Edit2,
  Brain,
  Cpu,
  Save,
  ChevronLeft
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { getBase64Image, OFFICIAL_LOGO_BASE64 } from '../src/lib/exportUtils';
import { extractClientDocumentText } from '../src/lib/clientDocumentText';
import { recognizeAdministrativePagesFast } from '../src/lib/fastAdministrativeOcr';
import { detectAdministrativeDataFromText, formatIban, formatSpanishSocialSecurityNumber } from '../src/lib/personalDataValidators';
import { RemoteScannerPairing } from './RemoteScannerPairing';

interface CapturedPage {
  id: string;
  base64: string;
  name: string;
  size: number; // in bytes
  width: number;
  height: number;
}

export interface WorkerRelation {
  apellidosNombre: string;
  dni: string;
  nuss: string;
  categoria: string;
  telefono: string;
  correo: string;
  obra: string;
  municipio: string;
  fechaInicio: string;
  duracionContrato: string;
}

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
  onAddWorkers?: (workers: any[]) => void;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({ isOpen, onClose, onToast, onAddWorkers }) => {
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [pdfName, setPdfName] = useState(() => {
    const now = new Date();
    const formattedDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    const formattedTime = now.toTimeString().slice(0, 5).replace(/:/g, '');
    return `PROFEA_Escaneo_${formattedDate}_${formattedTime}`;
  });
  const [quality, setQuality] = useState<'baja' | 'media' | 'alta'>('media'); // 'alta' means higher compression/smaller size (reduced), 'baja' is higher quality/bigger size
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isContinuous, setIsContinuous] = useState(true);

  // States for AI Worker Recognition & Relation Sheet
  const [recognizedWorkers, setRecognizedWorkers] = useState<WorkerRelation[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isRecognizingAdministrative, setIsRecognizingAdministrative] = useState(false);
  const [showRelationView, setShowRelationView] = useState(false);
  const [recognitionStep, setRecognitionStep] = useState<string>('');

  const [isLiveActive, setIsLiveActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isMobileCameraDevice, setIsMobileCameraDevice] = useState(false);
  const [hasLocalCamera, setHasLocalCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const mobileByUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const touchDevice = (navigator.maxTouchPoints || 0) > 0;
    const mobileLike = mobileByUa || (coarsePointer && touchDevice);
    const mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);

    setIsMobileCameraDevice(mobileLike);
    setHasLocalCamera(mediaSupported);

    if (mediaSupported && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then(devices => {
          const hasVideoInput = devices.some(device => device.kind === 'videoinput');
          setHasLocalCamera(hasVideoInput || mediaSupported);
        })
        .catch(() => setHasLocalCamera(mediaSupported));
    }
  }, []);

  // Clean up on unmount or when modal closes
  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startLiveCamera = async (mode: 'environment' | 'user' = facingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      onToast('Este navegador no permite vista previa en directo. Se abre la cámara nativa.', 'error');
      return;
    }

    setIsCameraLoading(true);
    setIsVideoReady(false);
    setCameraError('');
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = mediaStream;
      setFacingMode(mode);
      setIsLiveActive(true);
    } catch (err) {
      console.error('Error iniciando cámara web interactiva:', err);
      setCameraError('No se ha podido mostrar la cámara. Revisa el permiso del navegador.');
      fileInputRef.current?.click();
      onToast('No se pudo abrir la vista previa. Se ha abierto la cámara nativa como alternativa.', 'error');
    } finally {
      setIsCameraLoading(false);
    }
  };

  React.useEffect(() => {
    if (!isLiveActive || !videoRef.current || !streamRef.current) return;

    const video = videoRef.current;
    const mediaStream = streamRef.current;
    video.srcObject = mediaStream;

    const markReady = () => setIsVideoReady(video.videoWidth > 0 && video.videoHeight > 0);
    video.addEventListener('loadedmetadata', markReady);
    video.addEventListener('canplay', markReady);
    video.play().catch(error => {
      console.error('Error al reproducir la vista previa de cámara:', error);
      setCameraError('Toca la pantalla y vuelve a abrir la cámara para iniciar la vista previa.');
    });

    return () => {
      video.removeEventListener('loadedmetadata', markReady);
      video.removeEventListener('canplay', markReady);
      if (video.srcObject === mediaStream) video.srcObject = null;
    };
  }, [isLiveActive, facingMode]);

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoReady(false);
    setCameraError('');
    setIsLiveActive(false);
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    startLiveCamera(nextMode);
  };


  const openThisDeviceCamera = async () => {
    if (!hasLocalCamera || !navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      onToast('Abriendo la cámara nativa disponible en este dispositivo.', 'success');
      return;
    }
    await startLiveCamera('environment');
  };

  const captureFrame = () => {
    if (!videoRef.current || !isVideoReady || videoRef.current.readyState < 2) {
      onToast('Espera a que aparezca la imagen de la cámara antes de hacer la foto.', 'error');
      return;
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, width, height);
    const base64Str = canvas.toDataURL('image/jpeg', 0.95);
    
    // Quick flash effect
    const flashOverlay = document.getElementById('camera-flash-overlay');
    if (flashOverlay) {
      flashOverlay.classList.remove('opacity-0');
      flashOverlay.classList.add('opacity-100');
      setTimeout(() => {
        flashOverlay.classList.remove('opacity-100');
        flashOverlay.classList.add('opacity-0');
      }, 150);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString().replace(/:/g, '');
    const name = `Foto_${timeStr}.jpg`;

    compressImage(base64Str, name, (compressed) => {
      setPages((prev) => {
        const nextPages = [...prev, compressed];
        setTimeout(() => {
          onToast(`Página ${nextPages.length} capturada ✔️`, 'success');
        }, 0);
        return nextPages;
      });
      if (!isContinuous) stopLiveCamera();
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleRemoteCapture = React.useCallback((imageData: string, fileName: string) => {
    const img = new Image();
    img.onload = () => {
      const page: CapturedPage = {
        id: `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        base64: imageData,
        name: fileName || `Captura_movil_${Date.now()}.jpg`,
        size: Math.round((imageData.length * 3) / 4),
        width: img.width || 1200,
        height: img.height || 1600,
      };
      setPages(prev => [...prev, page]);
    };
    img.src = imageData;
  }, []);

  if (!isOpen) return null;

  // Process selected file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isGallery = false) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let processedCount = 0;
    const totalFiles = files.length;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (!result) return;

        // Compress image first before storing to save React state memory & make it faster
        compressImage(result, file.name, (compressed) => {
          processedCount++;
          const currentCount = processedCount;
          setPages((prev) => {
            const nextPages = [...prev, compressed];
            
            setTimeout(() => {
              if (!isGallery && isContinuous) {
                onToast(`Página ${nextPages.length} capturada con éxito. Abriendo cámara para la siguiente...`, 'success');
                setTimeout(() => {
                  fileInputRef.current?.click();
                }, 600);
              } else if (currentCount === totalFiles) {
                onToast(`${totalFiles} página(s) agregada(s) con éxito`, 'success');
              }
            }, 0);
            return nextPages;
          });
        });
      };
      reader.readAsDataURL(file);
    });

    // Reset input value to allow uploading the same file again
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  // On-the-fly image compression using canvas
  const compressImage = (base64Str: string, originalName: string, callback: (page: CapturedPage) => void) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Max dimensions for "reduced" size
      const maxDim = 1200; 
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        callback({
          id: Math.random().toString(36).substr(2, 9),
          base64: base64Str,
          name: originalName,
          size: Math.round((base64Str.length * 3) / 4),
          width: img.width || 800,
          height: img.height || 1100,
        });
        return;
      }

      // Draw and resize
      ctx.drawImage(img, 0, 0, width, height);

      // Determine quality parameter
      // 'alta' preset = high compression (reduced PDF) -> lower jpeg quality (0.4)
      // 'media' preset = medium compression -> jpeg quality (0.6)
      // 'baja' preset = low compression (higher quality) -> jpeg quality (0.8)
      let q = 0.6;
      if (quality === 'alta') q = 0.4;
      if (quality === 'baja') q = 0.8;

      const compressedBase64 = canvas.toDataURL('image/jpeg', q);
      const estimatedSize = Math.round((compressedBase64.length * 3) / 4);

      callback({
        id: Math.random().toString(36).substr(2, 9),
        base64: compressedBase64,
        name: originalName.replace(/\.[^/.]+$/, "") + "_escaneado.jpg",
        size: estimatedSize,
        width: width,
        height: height,
      });
    };
  };

  const deletePage = (id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  };

  const movePage = (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index === 0) return;
    if (direction === 'right' && index === pages.length - 1) return;

    const newPages = [...pages];
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    const temp = newPages[index];
    newPages[index] = newPages[targetIndex];
    newPages[targetIndex] = temp;
    setPages(newPages);
  };

  const clearAll = () => {
    if (window.confirm('¿Está seguro de que desea borrar todas las páginas capturadas?')) {
      setPages([]);
    }
  };

  // Convert bytes to readable size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 1;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Total size of all pages
  const totalSize = pages.reduce((acc, p) => acc + p.size, 0);

  // AI OCR Worker Recognition Functions
  const handleRecognizeWorkers = async () => {
    if (pages.length === 0) {
      onToast("Por favor, capture o añada al menos una página de documento.", "error");
      return;
    }

    setIsRecognizing(true);
    setRecognitionStep("Iniciando motor de IA y optimizando imágenes para extracción...");

    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      setRecognitionStep("Transmitiendo páginas escaneadas a Gemini 3.5 para lectura multimodal...");
      
      const imagesPayload = pages.map(p => p.base64);
      
      const response = await fetch("/api/recognize-workers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ images: imagesPayload })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor (${response.status})`);
      }

      setRecognitionStep("Procesando patrones de texto, contratos y datos personales...");
      await new Promise(resolve => setTimeout(resolve, 600));

      const data = await response.json();
      if (data.success && Array.isArray(data.workers)) {
        setRecognizedWorkers(data.workers);
        setShowRelationView(true);
        onToast(`¡Se han reconocido ${data.workers.length} trabajadores de la documentación!`, "success");
      } else {
        throw new Error("El servidor devolvió un formato de datos inesperado.");
      }
    } catch (err: any) {
      console.error(err);
      onToast(`Error en reconocimiento con IA: ${err.message}`, "error");
    } finally {
      setIsRecognizing(false);
      setRecognitionStep("");
    }
  };

  const dataUrlToFile = async (dataUrl: string, name: string): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], name || 'documento.jpg', { type: blob.type || 'image/jpeg' });
  };

  const handleRecognizeAdministrativeData = async () => {
    if (!pages.length) {
      onToast('Captura primero el documento que contiene DNI/NIE, fecha de nacimiento, Seguridad Social o IBAN.', 'error');
      return;
    }
    setIsRecognizingAdministrative(true);
    try {
      const detected = await recognizeAdministrativePagesFast(
        pages.map(page => ({ base64: page.base64, name: page.name })),
        (message) => setRecognitionStep(message),
      );

      if (!detected.dni && !detected.birthDate && !detected.nuss && !detected.iban) {
        onToast('No se han detectado datos administrativos válidos. Repite la foto o introdúcelos manualmente.', 'error');
        return;
      }

      const elapsed = Math.max(0.1, detected.elapsedMs / 1000).toFixed(1);
      const lines = [
        detected.dni ? `DNI/NIE: ${detected.dni}` : 'DNI/NIE: no detectado',
        detected.birthDate ? `Fecha de nacimiento: ${detected.birthDate.split('-').reverse().join('/')}` : 'Fecha de nacimiento: no detectada',
        detected.nuss ? `Nº Seguridad Social: ${formatSpanishSocialSecurityNumber(detected.nuss)}` : 'Nº Seguridad Social: no detectado',
        detected.iban ? `IBAN: ${formatIban(detected.iban)}` : 'IBAN: no detectado',
        `OCR: ${detected.pagesProcessed} página(s) · ${elapsed} s`,
        ...detected.warnings,
      ];

      if (!window.confirm(`DATOS DETECTADOS\n\n${lines.join('\n')}\n\n¿Incorporar estos datos al trabajador que estás registrando?`)) return;

      window.dispatchEvent(new CustomEvent('profea:administrative-data-recognized', {
        detail: {
          dni: detected.dni,
          birthDate: detected.birthDate,
          nuss: detected.nuss,
          iban: detected.iban,
          documentText: detected.text,
        },
      }));
      onToast(`Datos reconocidos en ${elapsed} s e incorporados al registro en curso.`, 'success');
      handleClose();
    } catch (error: any) {
      console.error('OCR administrativo rápido:', error?.message || error);
      onToast('No se han podido reconocer los datos. Puedes repetir el escaneo o introducirlos manualmente.', 'error');
    } finally {
      setIsRecognizingAdministrative(false);
      setRecognitionStep('');
    }
  };

  const handleWorkerFieldChange = (index: number, field: keyof WorkerRelation, value: string) => {
    setRecognizedWorkers(prev => prev.map((w, i) => i === index ? { ...w, [field]: value } : w));
  };

  const handleDeleteWorkerRelation = (index: number) => {
    setRecognizedWorkers(prev => prev.filter((_, i) => i !== index));
    onToast("Fila eliminada de la relación", "success");
  };

  const handleAddWorkerRelation = () => {
    const newW: WorkerRelation = {
      apellidosNombre: "APELLIDOS, Nombre",
      dni: "",
      nuss: "",
      categoria: "",
      telefono: "",
      correo: "",
      obra: "",
      municipio: "",
      fechaInicio: "",
      duracionContrato: ""
    };
    setRecognizedWorkers(prev => [...prev, newW]);
    onToast("Nueva fila vacía añadida a la relación", "success");
  };

  const exportWorkersExcel = async () => {
    if (recognizedWorkers.length === 0) {
      onToast("No hay datos en la relación para exportar.", "error");
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Relación PROFEA Extracción");

      worksheet.pageSetup = {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1
      };

      const logoBase64 = await getBase64Image(OFFICIAL_LOGO_BASE64);
      if (logoBase64) {
        const imageId = workbook.addImage({
          base64: logoBase64,
          extension: 'png',
        });
        worksheet.addImage(imageId, {
          tl: { col: 0.2, row: 0.2 },
          ext: { width: 195, height: 30 }
        });
      }

      worksheet.mergeCells("A1:J1");
      const titleCell = worksheet.getCell("A1");
      titleCell.value = "RELACIÓN DE TRABAJADORES EXTRAÍDOS POR IA (PLAN PROFEA)";
      titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "00548E" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      worksheet.getRow(1).height = 40;

      const subtitleCell = worksheet.getCell("A2");
      worksheet.mergeCells("A2:J2");
      subtitleCell.value = `Documentación de origen: ${pdfName}.pdf | Relación autogenerada por IA`;
      subtitleCell.font = { name: "Arial", italic: true, size: 9, color: { argb: "555555" } };
      subtitleCell.alignment = { horizontal: "center", vertical: "middle" };

      const headers = [
        "APELLIDOS Y NOMBRE",
        "DNI / NIE",
        "NUSS",
        "CATEGORÍA",
        "TELÉFONO",
        "CORREO ELECTRÓNICO",
        "OBRA / PROYECTO",
        "MUNICIPIO",
        "FECHA INICIO",
        "DURACIÓN CONTRATO"
      ];

      const headerRow = worksheet.getRow(4);
      headerRow.height = 26;
      headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "00548E" } };
        cell.font = { color: { argb: "FFFFFF" }, bold: true, size: 9 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      });

      recognizedWorkers.forEach((w, idx) => {
        const rowData = [
          w.apellidosNombre,
          w.dni,
          w.nuss,
          w.categoria,
          w.telefono,
          w.correo,
          w.obra,
          w.municipio,
          w.fechaInicio,
          w.duracionContrato
        ];
        const row = worksheet.addRow(rowData);
        row.height = 22;
        row.eachCell((cell, colIdx) => {
          cell.font = { size: 9, name: "Arial" };
          cell.alignment = { vertical: "middle", horizontal: colIdx === 1 ? "left" : "center", wrapText: true };
          cell.border = { 
            top: { style: "thin", color: { argb: "E2E8F0" } }, 
            left: { style: "thin", color: { argb: "E2E8F0" } }, 
            bottom: { style: "thin", color: { argb: "E2E8F0" } }, 
            right: { style: "thin", color: { argb: "E2E8F0" } } 
          };
          if (idx % 2 !== 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
          }
        });
      });

      worksheet.columns.forEach((column) => {
        let maxL = 0;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const l = cell.value ? cell.value.toString().length : 0;
          if (l > maxL) maxL = l;
        });
        column.width = Math.max(13, Math.min(35, maxL + 3));
      });

      const lastRowNum = worksheet.rowCount + 2;
      worksheet.mergeCells(`A${lastRowNum}:J${lastRowNum}`);
      const footCell = worksheet.getCell(`A${lastRowNum}`);
      footCell.value = `© ${new Date().getFullYear()} David Hinojo García | Extracción Digital Certificada PROFEA`;
      footCell.font = { name: "Arial", italic: true, size: 8, color: { argb: "888888" } };
      footCell.alignment = { horizontal: "left" };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Relacion_Trabajadores_IA_${pdfName}.xlsx`;
      link.click();
      onToast("Relación exportada a Excel (.xlsx) correctamente", "success");
    } catch (err) {
      console.error(err);
      onToast("No se pudo exportar a Excel", "error");
    }
  };

  const exportWorkersPDF = async () => {
    if (recognizedWorkers.length === 0) {
      onToast("No hay trabajadores en la relación para exportar.", "error");
      return;
    }

    try {
      const doc = new jsPDF({ orientation: "landscape", format: "a4" });

      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text("EXCMA. DIPUTACIÓN PROVINCIAL DE CÁDIZ", 14, 12);
      doc.text("ÁREA DE COOPERACIÓN | GESTIÓN PROFEA", 14, 16);
      
      try {
        const logoBase64 = await getBase64Image(OFFICIAL_LOGO_BASE64);
        if (logoBase64) {
          doc.addImage(logoBase64, 'PNG', 231, 4, 52, 8);
        }
      } catch (err) {
        console.warn('Logo addition failed:', err);
      }

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 84, 142);
      doc.text(`RELACIÓN DE TRABAJADORES RECONOCIDOS POR IA (PROFEA)`, 14, 25);
      
      doc.setDrawColor(0, 84, 142);
      doc.setLineWidth(0.5);
      doc.line(14, 27, 283, 27);

      const tableColumn = [
        "Apellidos y Nombre", 
        "DNI / NIE", 
        "NUSS", 
        "Categoría", 
        "Teléfono / Correo", 
        "Obra / Proyecto", 
        "Municipio", 
        "Inicio / Duración"
      ];

      const tableRows = recognizedWorkers.map(w => [
        w.apellidosNombre,
        w.dni || "-",
        w.nuss || "-",
        w.categoria || "-",
        `${w.telefono || "-"}\n${w.correo || "-"}`,
        w.obra || "-",
        w.municipio || "-",
        `${w.fechaInicio || "-"}\n(${w.duracionContrato || "-"})`
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 32,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2.5, valign: "middle", halign: "center" as const },
        headStyles: { fillColor: [0, 84, 142], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 48, halign: "left", fontStyle: "bold" },
          1: { cellWidth: 22 },
          2: { cellWidth: 24 },
          3: { cellWidth: 24 },
          4: { cellWidth: 38, halign: "left" },
          5: { cellWidth: 48, halign: "left" },
          6: { cellWidth: 24 },
          7: { cellWidth: 24 }
        },
        alternateRowStyles: { fillColor: [245, 250, 255] }
      });

      doc.setFontSize(7.5);
      doc.setTextColor(150);
      doc.text(`Relación autogenerada por IA el ${new Date().toLocaleString("es-ES")} | © David Hinojo García`, 14, doc.internal.pageSize.height - 10);

      doc.save(`Relacion_Trabajadores_IA_${pdfName}.pdf`);
      onToast("Relación exportada a PDF correctamente", "success");
    } catch (err) {
      console.error(err);
      onToast("No se pudo exportar a PDF", "error");
    }
  };

  const handleImportToSystem = () => {
    if (recognizedWorkers.length === 0) {
      onToast("No hay ningún trabajador en el listado para importar.", "error");
      return;
    }

    if (!onAddWorkers) {
      onToast("La funcionalidad de importación directa no está configurada.", "error");
      return;
    }

    if (window.confirm(`¿Desea importar los ${recognizedWorkers.length} trabajadores de la relación directamente al listado general del sistema?`)) {
      const formatted = recognizedWorkers.map(w => {
        return {
          supervisorResponsable: "",
          numOferta: "",
          obra: w.obra || "",
          categoria: w.categoria || "Peón",
          quincena: "1ª Quincena",
          apellidosNombre: w.apellidosNombre,
          dni: w.dni || "",
          fechaNacimiento: "",
          periodoInicio: w.fechaInicio || "",
          periodoFin: "",
          telefono: w.telefono || "",
          calzado: "No entregado",
          formacion: "No" as const,
          citaDia: "",
          citaHora: "",
          sitioReconocimiento: "",
          documentacionCompleta: "No" as const,
          necesitaReconocimiento: "Sí" as const,
          observaciones: `Reconocido por IA de documento: ${pdfName}. Duración contrato: ${w.duracionContrato || "S/D"}. NUSS: ${w.nuss || "S/D"}. Correo: ${w.correo || "S/D"}. Municipio: ${w.municipio || "S/D"}.`
        };
      });

      onAddWorkers(formatted);
      onToast(`¡Se han registrado ${formatted.length} nuevos trabajadores de forma masiva!`, "success");
      setShowRelationView(false);
      onClose();
    }
  };

  // Generate jsPDF
  const generatePDF = async (shouldShare = false) => {
    if (pages.length === 0) {
      onToast('Agregue al menos una página para exportar', 'error');
      return;
    }

    setIsGenerating(true);

    try {
      // Delay slightly to allow loading animation to trigger smoothly
      await new Promise((resolve) => setTimeout(resolve, 500));

      const firstPage = pages[0];
      const doc = new jsPDF({
        orientation: (firstPage.width || 800) > (firstPage.height || 1100) ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const isLandscape = (page.width || 800) > (page.height || 1100);
        
        // Add new page if not the first one with the correct orientation
        if (i > 0) {
          doc.addPage('a4', isLandscape ? 'landscape' : 'portrait');
        }

        // Standard DIN A4 dimensions
        const pWidth = isLandscape ? 297 : 210;
        const pHeight = isLandscape ? 210 : 297;

        // Use a small 5mm margin to ensure full document elements are visible & printable
        const margin = 5;
        const maxW = pWidth - (margin * 2);
        const maxH = pHeight - (margin * 2);

        // Aspect ratio calculations
        const imgRatio = (page.width || 800) / (page.height || 1100);
        const pageRatio = maxW / maxH;

        let destW = maxW;
        let destH = maxH;

        if (imgRatio > pageRatio) {
          destW = maxW;
          destH = maxW / imgRatio;
        } else {
          destH = maxH;
          destW = maxH * imgRatio;
        }

        const destX = margin + (maxW - destW) / 2;
        const destY = margin + (maxH - destH) / 2;

        doc.addImage(page.base64, 'JPEG', destX, destY, destW, destH, undefined, 'FAST');
      }

      const finalFileName = `${pdfName.trim() || 'Documento_Escaneado'}.pdf`;

      if (shouldShare) {
        // Native Share API support (for mobile devices)
        const pdfBlob = doc.output('blob');
        const pdfFile = new File([pdfBlob], finalFileName, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: 'Documento Escaneado PROFEA',
            text: 'Adjunto documento escaneado listo para enviar.',
          });
          onToast('Documento compartido con éxito', 'success');
        } else {
          // Fallback if sharing is not supported
          doc.save(finalFileName);
          onToast('Descarga iniciada (compartir nativo no compatible)', 'success');
        }
      } else {
        // Standard Download
        doc.save(finalFileName);
        onToast('PDF descargado con éxito', 'success');
      }
    } catch (err) {
      console.error(err);
      onToast('Error al generar el PDF', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    stopLiveCamera();
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-[110] flex items-center justify-center ${isLiveActive ? 'p-0 sm:p-4' : 'p-4'} bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md overflow-y-auto no-print`}>
      
      {/* Hidden file inputs */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={fileInputRef}
        onChange={(e) => handleFileChange(e, false)}
        className="hidden" 
        id="camera-capture-input"
      />
      <input 
        type="file" 
        accept="image/*" 
        multiple
        ref={galleryInputRef}
        onChange={(e) => handleFileChange(e, true)}
        className="hidden" 
        id="gallery-capture-input"
      />
 
      <div className={`relative w-full max-w-4xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${isLiveActive ? 'h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-3xl' : 'max-h-[90vh] rounded-3xl'}`}>
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#00548E]/10 dark:bg-blue-500/20 rounded-xl flex items-center justify-center text-[#00548E] dark:text-blue-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">Escáner de Documentos</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Escáner móvil vinculado por QR y cámara de este dispositivo</p>
            </div>
          </div>
          <button 
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
 
        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
          {isLiveActive ? (
            <section className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-label="Vista previa de la cámara">
              <div className="relative min-h-[52dvh] overflow-hidden rounded-2xl bg-black shadow-inner sm:aspect-[4/3] sm:min-h-0">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={() => setIsVideoReady(Boolean(videoRef.current?.videoWidth))}
                  className="h-full w-full object-cover"
                  aria-label="Imagen en directo de la cámara"
                />
                <div id="camera-flash-overlay" className="pointer-events-none absolute inset-0 z-20 bg-white opacity-0 transition-opacity duration-150" />
                <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-white/55 shadow-[0_0_0_9999px_rgba(0,0,0,0.12)]" />
                <div className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
                  {isVideoReady ? 'Cámara lista' : 'Preparando cámara…'}
                </div>
                {cameraError && (
                  <div role="alert" className="absolute inset-x-4 bottom-4 rounded-xl bg-red-600/90 p-3 text-center text-sm font-semibold text-white">
                    {cameraError}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={stopLiveCamera} className="justify-self-start rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  Cancelar
                </button>
                <button type="button" onClick={captureFrame} disabled={!isVideoReady} aria-label="Hacer foto" className="grid h-20 w-20 place-items-center rounded-full border-[6px] border-white bg-emerald-600 text-white shadow-xl ring-2 ring-slate-400 transition active:scale-95 disabled:cursor-wait disabled:bg-slate-500 disabled:opacity-70">
                  {isVideoReady ? <Camera className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
                </button>
                <button type="button" onClick={toggleFacingMode} disabled={isCameraLoading} className="justify-self-end rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white" aria-label="Cambiar entre cámara trasera y frontal">
                  <RefreshCw className="mx-auto h-5 w-5" />
                  <span className="mt-1 block text-[10px]">Cambiar</span>
                </button>
              </div>
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                Centra el documento dentro del marco y pulsa el botón verde para hacer la foto.
              </p>
            </section>
          ) : isRecognizing ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-in fade-in duration-200">
              <div className="relative mb-6">
                <div className="w-20 h-20 bg-blue-50 dark:bg-blue-950/40 rounded-full flex items-center justify-center text-[#00548E] dark:text-blue-400">
                  <Brain className="w-10 h-10 animate-pulse text-[#00548E] dark:text-blue-400" />
                </div>
                <div className="absolute -inset-2 rounded-full border border-dashed border-blue-400 dark:border-blue-500 animate-spin" style={{ animationDuration: "8s" }} />
              </div>
              
              <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Extrayendo Datos con Inteligencia Artificial
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md">
                {recognitionStep || "Iniciando análisis de documentación..."}
              </p>
              
              <div className="w-full max-w-xs bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-6 overflow-hidden relative">
                <div className="absolute top-0 bottom-0 left-0 bg-[#00548E] dark:bg-blue-500 rounded-full animate-pulse w-full" />
              </div>
            </div>
          ) : showRelationView ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#00548E] dark:text-blue-400 animate-pulse" />
                    Relación de Datos de Trabajadores Extraídos por IA
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Revisa, añade o modifica los datos detectados antes de proceder a la exportación o importación.</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddWorkerRelation}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                    Añadir Fila
                  </button>
                  <button
                    onClick={() => setShowRelationView(false)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Volver a Capturar
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                <div className="overflow-x-auto max-h-[45vh] custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                        <th className="px-4 py-3 min-w-[180px]">Apellidos y Nombre</th>
                        <th className="px-4 py-3 min-w-[110px]">DNI/NIE</th>
                        <th className="px-4 py-3 min-w-[110px]">NUSS</th>
                        <th className="px-4 py-3 min-w-[110px]">Categoría</th>
                        <th className="px-4 py-3 min-w-[110px]">Teléfono</th>
                        <th className="px-4 py-3 min-w-[140px]">Obra</th>
                        <th className="px-4 py-3 min-w-[110px]">Inicio / Duración</th>
                        <th className="px-4 py-3 min-w-[90px] text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {recognizedWorkers.map((worker, index) => (
                        <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20 transition-colors">
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.apellidosNombre}
                              onChange={(e) => handleWorkerFieldChange(index, "apellidosNombre", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.dni}
                              onChange={(e) => handleWorkerFieldChange(index, "dni", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800 font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.nuss}
                              onChange={(e) => handleWorkerFieldChange(index, "nuss", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800 font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.categoria}
                              onChange={(e) => handleWorkerFieldChange(index, "categoria", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.telefono}
                              onChange={(e) => handleWorkerFieldChange(index, "telefono", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={worker.obra}
                              onChange={(e) => handleWorkerFieldChange(index, "obra", e.target.value)}
                              className="w-full px-2 py-1.5 border-0 bg-transparent rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E] focus:bg-white dark:focus:bg-slate-800"
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex flex-col gap-1">
                              <input
                                type="text"
                                value={worker.fechaInicio}
                                placeholder="Fecha Inicio"
                                onChange={(e) => handleWorkerFieldChange(index, "fechaInicio", e.target.value)}
                                className="w-full px-2 py-1 border border-slate-100 dark:border-slate-800 bg-transparent rounded-md text-[11px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E]"
                              />
                              <input
                                type="text"
                                value={worker.duracionContrato}
                                placeholder="Duración"
                                onChange={(e) => handleWorkerFieldChange(index, "duracionContrato", e.target.value)}
                                className="w-full px-2 py-1 border border-slate-100 dark:border-slate-800 bg-transparent rounded-md text-[11px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-[#00548E]"
                              />
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleDeleteWorkerRelation(index)}
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors"
                              title="Eliminar fila"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <>
              {isMobileCameraDevice && (
                <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20">
                  <button
                    type="button"
                    onClick={openThisDeviceCamera}
                    disabled={isCameraLoading}
                    className="w-full flex items-center justify-center gap-3 px-5 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-wait text-white shadow-sm transition-colors"
                  >
                    {isCameraLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
                    <div className="text-left">
                      <div className="text-sm font-extrabold">Usar cámara de este dispositivo</div>
                      <div className="text-[11px] text-emerald-50">
                        {hasLocalCamera ? 'Cámara detectada · se abrirá preferentemente la cámara trasera' : 'Se intentará abrir la cámara nativa del móvil o tablet'}
                      </div>
                    </div>
                  </button>
                </div>
              )}

              <RemoteScannerPairing onCapture={handleRemoteCapture} onToast={onToast} />

              {/* Continuous Capture Mode Switch Card */}
              <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/60 flex items-center justify-center text-[#00548E] dark:text-blue-400 shrink-0">
                    <RefreshCw className={`w-5 h-5 ${isContinuous ? "animate-spin-slow" : ""}`} style={{ animationDuration: "3s" }} />
                  </div>
                  <div className="text-center sm:text-left">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Modo Continuo / Ráfaga Inteligente</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Permite tomar múltiples fotos seguidas de forma instantánea sin interrumpir el flujo.</p>
                  </div>
                </div>
                
                <button
                  onClick={() => setIsContinuous(!isContinuous)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    isContinuous ? "bg-[#00548E] dark:bg-blue-600" : "bg-slate-200 dark:bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isContinuous ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Top Actions Block */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Camera Trigger */}
                <button
                  onClick={() => startLiveCamera("environment")}
                  className="group flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#00548E] to-[#003860] hover:from-[#006bb5] hover:to-[#00548E] text-white rounded-2xl shadow-md transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                >
                  {isCameraLoading ? (
                    <Loader2 className="w-8 h-8 mb-2 animate-spin" />
                  ) : (
                    <Camera className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform duration-300" />
                  )}
                  <span className="font-bold text-sm tracking-wide">Capturar con Cámara</span>
                  <span className="text-[10px] text-blue-100/85 mt-1 font-medium">Activa cámara interactiva en ráfaga</span>
                </button>

                {/* Gallery Upload */}
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  className="group flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                >
                  <ImageIcon className="w-8 h-8 mb-2 text-[#00548E] dark:text-blue-400 group-hover:scale-110 transition-transform duration-300" />
                  <span className="font-bold text-sm tracking-wide">Añadir desde Galería</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-400 mt-1 font-medium">Permite seleccionar múltiples imágenes</span>
                </button>

              </div>

              {/* Fallback to traditional capture */}
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold text-[#00548E] dark:text-blue-400 hover:underline flex items-center gap-1.5"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Usar capturadora nativa del sistema (modo alternativo)
                </button>
              </div>
            </>
          )}

          {/* Captured Pages List Container */}
          {!isLiveActive && !showRelationView && !isRecognizing && (
            <>
              {pages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/20 dark:bg-slate-900/10">
                  <FileText className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-4 animate-pulse" />
                  <p className="text-base font-bold text-slate-700 dark:text-slate-300">Ninguna página capturada todavía</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 text-center max-w-sm px-4">
                    Haz clic en el botón de la cámara para capturar la primera página o sube fotos desde tu galería para compilar tu PDF.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Páginas Capturadas ({pages.length})
                    </span>
                    <button
                      onClick={clearAll}
                      className="text-xs font-bold text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Vaciar Todo
                    </button>
                  </div>

                  {/* Thumbnails list */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {pages.map((page, index) => (
                      <div 
                        key={`page_${page.id}_${index}`}
                        className="relative group bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-2xl p-2.5 flex flex-col items-center overflow-hidden hover:shadow-md transition-shadow"
                      >
                        {/* Page Number Badge */}
                        <span className="absolute top-4 left-4 z-10 px-2 py-1 bg-slate-900/70 text-white text-[10px] font-extrabold rounded-lg backdrop-blur-sm">
                          Pág {index + 1}
                        </span>

                        {/* Dimensions & Size Label */}
                        <span className="absolute bottom-16 right-4 z-10 px-1.5 py-0.5 bg-slate-900/50 text-white text-[9px] font-medium rounded">
                          {formatBytes(page.size)}
                        </span>

                        {/* Preview / Image */}
                        <div className="w-full aspect-[3/4] bg-slate-100 dark:bg-slate-900 rounded-xl overflow-hidden mb-3 relative flex items-center justify-center">
                          <img 
                            src={page.base64} 
                            alt={`Página ${index + 1}`} 
                            className="w-full h-full object-cover"
                          />
                          
                          {/* Overlay Controls */}
                          <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
                            <button
                              onClick={() => setPreviewImage(page.base64)}
                              className="p-2 bg-white hover:bg-slate-100 text-slate-800 rounded-full shadow transition-all duration-150 transform hover:scale-110"
                              title="Ampliar vista"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deletePage(page.id)}
                              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow transition-all duration-150 transform hover:scale-110"
                              title="Eliminar página"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Order adjustment actions */}
                        <div className="flex items-center justify-between w-full border-t border-slate-100 dark:border-slate-800/80 pt-2">
                          <button
                            onClick={() => movePage(index, "left")}
                            disabled={index === 0}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors"
                            title="Subir orden"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                          <span className="text-[10px] font-bold text-slate-400">Orden</span>
                          <button
                            onClick={() => movePage(index, "right")}
                            disabled={index === pages.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors"
                            title="Bajar orden"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>

                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Configuration & Options Block */}
              {pages.length > 0 && (
                <div className="p-5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* PDF File name settings */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Nombre del Documento
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={pdfName}
                        onChange={(e) => setPdfName(e.target.value)}
                        placeholder="PROFEA_Documento_Escaneo"
                        className="w-full pl-3 pr-12 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-[#00548E] dark:text-slate-100 transition-colors"
                      />
                      <span className="absolute right-3 top-3 text-slate-400 text-xs font-bold select-none">
                        .pdf
                      </span>
                    </div>
                  </div>

                  {/* Compression presets for reducing sizes */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Tamaño del Archivo (Compresión)
                      </label>
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-[#00548E]/10 dark:bg-blue-500/20 text-[#00548E] dark:text-blue-400 rounded-full">
                        Sugerido: Alta
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "alta", label: "Alta", desc: "Súper Reducido" },
                        { id: "media", label: "Media", desc: "Estándar" },
                        { id: "baja", label: "Baja", desc: "Mayor Detalle" }
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setQuality(preset.id as any)}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold flex flex-col items-center justify-center transition-all ${
                            quality === preset.id
                              ? "border-[#00548E] dark:border-blue-500 bg-[#00548E]/5 dark:bg-blue-500/10 text-[#00548E] dark:text-blue-400 ring-1 ring-[#00548E] dark:ring-blue-500"
                              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          <span>{preset.label}</span>
                          <span className="text-[8px] font-normal opacity-80 mt-0.5">{preset.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              )}
            </>
          )}

        </div>

        {/* Modal Footer / Compilation Area */}
        <div className={`${isLiveActive ? 'hidden' : 'flex'} px-6 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex-col sm:flex-row items-center justify-between gap-4`}>
          {showRelationView ? (
            <>
              {/* File Statistics Info */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-[#00548E] dark:text-blue-400 rounded-xl">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 block leading-none">Relación Extraída</span>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-base font-black text-slate-800 dark:text-white">
                      {recognizedWorkers.length} Trabajadores
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      (listos para exportar)
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto shrink-0 justify-end">
                <button
                  onClick={() => setShowRelationView(false)}
                  className="px-4 py-3 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Volver al Escáner
                </button>

                <button
                  onClick={exportWorkersExcel}
                  className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
                  title="Exportar listado a Excel"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Exportar Excel
                </button>

                <button
                  onClick={exportWorkersPDF}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
                  title="Exportar listado a PDF"
                >
                  <FileDown className="w-4 h-4" />
                  Exportar PDF
                </button>

                {onAddWorkers && (
                  <button
                    onClick={handleImportToSystem}
                    className="px-4 py-3 bg-[#00548E] hover:bg-[#003860] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-md"
                    title="Importar estos trabajadores al sistema"
                  >
                    <Save className="w-4 h-4" />
                    Importar al Sistema
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* File Statistics Info */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-500 dark:text-slate-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 block leading-none">PDF Estimado</span>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-base font-black text-slate-800 dark:text-white">
                      {pages.length > 0 ? formatBytes(totalSize) : "0 KB"}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      ({pages.length} {pages.length === 1 ? "página" : "páginas"})
                    </span>
                  </div>
                </div>
              </div>

              {/* Compile buttons */}
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto shrink-0">
                {pages.length > 0 && (
                  <button
                    onClick={handleRecognizeAdministrativeData}
                    disabled={isRecognizingAdministrative || isRecognizing}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                    title="Reconocer Nº de Seguridad Social e IBAN con OCR local"
                  >
                    {isRecognizingAdministrative ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                    Seguridad Social / IBAN
                  </button>
                )}

                {pages.length > 0 && (
                  <button
                    onClick={handleRecognizeWorkers}
                    disabled={isRecognizing}
                    className="px-4 py-3 bg-gradient-to-r from-blue-600 to-[#00548E] hover:from-blue-700 hover:to-[#003860] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md animate-pulse"
                    title="Extraer relaciones de trabajadores con IA"
                  >
                    <Sparkles className="w-4 h-4 animate-spin-slow" />
                    Reconocer con IA
                  </button>
                )}

                <button
                  onClick={handleClose}
                  disabled={isGenerating}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>

                {/* Standard PDF compiler trigger */}
                <button
                  onClick={() => generatePDF(false)}
                  disabled={pages.length === 0 || isGenerating}
                  className="w-full sm:w-auto px-5 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Compilando...
                    </>
                  ) : (
                    <>
                      <FileDown className="w-4 h-4" />
                      Descargar PDF
                    </>
                  )}
                </button>

                {/* Premium Smart Share trigger */}
                <button
                  onClick={() => generatePDF(true)}
                  disabled={pages.length === 0 || isGenerating}
                  className="w-full sm:w-auto px-5 py-3 bg-[#00548E] hover:bg-[#003860] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-md shadow-brand-primary/10 disabled:opacity-50 disabled:pointer-events-none"
                  title="Compartir directo por email o WhatsApp"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Share2 className="w-4 h-4" />
                  )}
                  Compartir / Enviar
                </button>
              </div>
            </>
          )}
        </div>

      </div>

      {/* Expanded Preview modal (lightbox) */}
      {previewImage && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          
          <div className="relative max-w-full max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
            <img 
              src={previewImage} 
              alt="Ampliada" 
              className="max-w-full max-h-[80vh] object-contain"
            />
          </div>
        </div>
      )}

    </div>
  );
};

