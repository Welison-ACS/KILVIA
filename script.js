// script.js (versão corrigida - renderiza modelo.html inteiro dentro de um iframe e converte sem deformar)
document.addEventListener("DOMContentLoaded", () => {
  const tipoSelect = document.getElementById("tipo");
  const preview = document.getElementById("preview");
  const gerarBtn = document.getElementById("gerar");

  tipoSelect.addEventListener("change", () => {
    const tipo = tipoSelect.value;
    preview.src = `${tipo}.png`;
  });

  gerarBtn.addEventListener("click", async () => {
    const tipo = tipoSelect.value;

    gerarBtn.disabled = true;
    gerarBtn.textContent = "Gerando PDF...";

    try {
      // 1) Carrega o modelo.html (inclui <head> com estilos)
      const resp = await fetch("modelo.html");
      if (!resp.ok) throw new Error("Não foi possível carregar modelo.html");
      const rawHtml = await resp.text();

      // 2) Parseia e modifica o HTML (título + imagens)
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");

      // Ajusta título
      const tituloDiv = doc.querySelector(".titulo");
      if (tituloDiv) {
        const tipoUpper = tipo.toUpperCase();
        tituloDiv.textContent = tipoUpper;

        // ajuste simples do padding/size baseado no comprimento
        tituloDiv.style.padding = "10px 40px";
        if (tipoUpper.length > 9) {
          tituloDiv.style.fontSize = "20px";
          tituloDiv.style.padding = "10px 30px";
        } else {
          tituloDiv.style.fontSize = "24px";
        }
      }

      // Substitui imagens laterais / centrais por <tipo>.png
      const imgsLaterais = doc.querySelectorAll(".img-lateral");
      imgsLaterais.forEach(img => img.setAttribute("src", `${tipo}.png`));

      const imgCentral = doc.querySelector(".imagem-central img");
      if (imgCentral) imgCentral.setAttribute("src", `${tipo}.png`);

      // 3) Cria iframe oculto e injeta o documento completo (head + body)
      const iframe = document.createElement("iframe");
      // A4 paisagem aproximado em px a 96dpi: 297mm x 96 / 25.4 ≈ 1123px ; 210mm -> ≈ 794px
      const iframeWidthPx = 1123;
      const iframeHeightPx = 794;

      iframe.style.position = "fixed";
      iframe.style.left = "-20000px";
      iframe.style.top = "0";
      iframe.style.width = iframeWidthPx + "px";
      iframe.style.height = iframeHeightPx + "px";
      iframe.style.border = "0";
      iframe.sandbox = ""; // manter permissões padrão (srcdoc same-origin)
      // serializa o documento inteiro (inclui <head> com <style>)
      const fullHtml = doc.documentElement.outerHTML;
      // use srcdoc para injetar o HTML completo no iframe
      iframe.srcdoc = fullHtml;

      document.body.appendChild(iframe);

      // 4) espera o iframe carregar completamente e todas as imagens dentro dele
      await new Promise((resolve, reject) => {
        iframe.onload = async () => {
          try {
            const ifdoc = iframe.contentDocument || iframe.contentWindow.document;

            // força o tamanho do body/html interno para a mesma dimensão (evita "auto" que pode quebrar layout)
            ifdoc.documentElement.style.width = iframeWidthPx + "px";
            ifdoc.body.style.width = iframeWidthPx + "px";
            ifdoc.documentElement.style.height = iframeHeightPx + "px";
            ifdoc.body.style.height = iframeHeightPx + "px";
            ifdoc.body.style.margin = "0"; // garante sem margens extras

            // espera todas imagens do iframe carregarem
            const imgs = Array.from(ifdoc.images || []);
            await Promise.all(imgs.map(img => {
              return new Promise(res => {
                if (img.complete) return res();
                img.onload = img.onerror = () => res();
              });
            }));

            // aguarda um pouquinho para garantir estilos aplicados/render completos
            setTimeout(resolve, 120);
          } catch (e) {
            reject(e);
          }
        };
        // caso o iframe não carregue por algum motivo
        setTimeout(() => reject(new Error("Timeout carregando iframe")), 8000);
      });

      // 5) captura o conteúdo do iframe com html2canvas
      const ifWindow = iframe.contentWindow;
      const ifDoc = iframe.contentDocument || ifWindow.document;
      const targetEl = ifDoc.body;

      // configuração de scale (aumenta qualidade do raster)
      const scale = 2; // <--- ajuste para mais qualidade (maior) ou menos (menor)
      const canvas = await html2canvas(targetEl, {
        scale: scale,
        useCORS: true,
        // limitar o tamanho do canvas ao tamanho do iframe para evitar capturas extras
        width: iframeWidthPx,
        height: iframeHeightPx,
        windowWidth: iframeWidthPx,
        windowHeight: iframeHeightPx,
        logging: false
      });

      // 6) converte dimensões do canvas (px) para mm corretamente para inserir no jsPDF
      // Conversão: 1 polegada = 25.4 mm ; DPI considerar 96 CSS px por polegada.
      // Lembre: canvas.width = cssPx * scale
      const dpi = 96;
      const pxToMm = 25.4 / (dpi * scale); // mm por canvas-pixel

      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;

      const imgWidthMm = imgWidthPx * pxToMm;
      const imgHeightMm = imgHeightPx * pxToMm;

      // 7) cria PDF A4 paisagem e calcula escala para caber sem deformar
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4"
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // ---- MARGENS (ajuste facilmente aqui) ----
      const margemX = 5; // mm - ajuste horizontal
      const margemY = 5; // mm - ajuste vertical
      // -------------------------------------------

      const maxW = pageW - margemX * 2;
      const maxH = pageH - margemY * 2;

      // escala proporcional sem deformar
      const scaleRatio = Math.min(maxW / imgWidthMm, maxH / imgHeightMm);

      const finalW = imgWidthMm * scaleRatio;
      const finalH = imgHeightMm * scaleRatio;

      const posX = (pageW - finalW) / 2;
      const posY = (pageH - finalH) / 2;

      const imgData = canvas.toDataURL("image/png");

      // 8) adiciona imagem ao PDF (as dimensões aqui são em mm)
      pdf.addImage(imgData, "PNG", posX, posY, finalW, finalH);

      // 9) baixa o PDF com nome simples
      pdf.save(`${tipo}.pdf`);

      // limpa iframe
      document.body.removeChild(iframe);

    } catch (err) {
      console.error(err);
      alert("Erro ao gerar PDF. Veja o console para detalhes.");
      gerarBtn.disabled = false;
      gerarBtn.textContent = "Gerar PDF";
      return;
    }

    gerarBtn.disabled = false;
    gerarBtn.textContent = "Gerar PDF";
  });
});
