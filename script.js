// script.js (corrigido: usa <base> para preservar caminhos relativos e logs melhores)
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
      // 1) Carrega o modelo.html
      const resp = await fetch("modelo.html");
      if (!resp.ok) throw new Error(`Não foi possível carregar modelo.html (status ${resp.status})`);
      const rawHtml = await resp.text();

      // 2) Parseia para manipular título e imagens
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");

      // Ajusta título
      const tituloDiv = doc.querySelector(".titulo");
      if (tituloDiv) {
        const tipoUpper = tipo.toUpperCase();
        tituloDiv.textContent = tipoUpper;
        tituloDiv.style.padding = "10px 40px";
        if (tipoUpper.length > 9) {
          tituloDiv.style.fontSize = "20px";
          tituloDiv.style.padding = "10px 30px";
        } else {
          tituloDiv.style.fontSize = "24px";
        }
      }

      // Substitui imagens laterais e central
      const imgsLaterais = doc.querySelectorAll(".img-lateral");
      imgsLaterais.forEach(img => img.setAttribute("src", `${tipo}.png`));
      const imgCentral = doc.querySelector(".imagem-central img");
      if (imgCentral) imgCentral.setAttribute("src", `${tipo}.png`);

      // 3) Gera <base> para manter caminhos relativos corretos dentro do iframe
      // baseHref = pasta atual onde index.html está (ex: http://localhost:5500/)
      const loc = window.location;
      const path = loc.pathname.substring(0, loc.pathname.lastIndexOf("/") + 1);
      const baseHref = `${loc.protocol}//${loc.host}${path}`;
      const baseEl = doc.createElement("base");
      baseEl.setAttribute("href", baseHref);
      // injeta no <head> do documento (cria um head se não existir)
      if (!doc.head) {
        const head = doc.createElement("head");
        head.appendChild(baseEl);
        doc.documentElement.insertBefore(head, doc.body);
      } else {
        doc.head.insertBefore(baseEl, doc.head.firstChild);
      }

      // 4) Serializa o documento completo
      const fullHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;

      // 5) Cria iframe oculto (A4 paisagem aproximado em px a 96dpi)
      const iframe = document.createElement("iframe");
      const iframeWidthPx = 1123; // aprox A4 landscape @96dpi
      const iframeHeightPx = 794;

      iframe.style.position = "fixed";
      iframe.style.left = "-20000px";
      iframe.style.top = "0";
      iframe.style.width = iframeWidthPx + "px";
      iframe.style.height = iframeHeightPx + "px";
      iframe.style.border = "0";
      // NÃO definir sandbox (pode bloquear recursos). Se quiser restringir, usar atributos específicos.
      iframe.srcdoc = fullHtml;
      document.body.appendChild(iframe);

      // 6) Espera o iframe carregar e imagens serem carregadas
      await new Promise((resolve, reject) => {
        let done = false;
        const timeoutMs = 12000; // tempo maior
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error("Timeout carregando iframe (verifique console/network)."));
          }
        }, timeoutMs);

        iframe.onload = async () => {
          try {
            const ifdoc = iframe.contentDocument || iframe.contentWindow.document;

            // garante dimensões internas fixas para evitar auto-resize
            ifdoc.documentElement.style.width = iframeWidthPx + "px";
            ifdoc.body.style.width = iframeWidthPx + "px";
            ifdoc.documentElement.style.height = iframeHeightPx + "px";
            ifdoc.body.style.height = iframeHeightPx + "px";
            ifdoc.body.style.margin = "0";

            // espera todas as imagens do iframe carregarem (ou erro)
            const imgs = Array.from(ifdoc.images || []);
            await Promise.all(imgs.map(img => {
              return new Promise(res => {
                if (img.complete) return res();
                img.onload = img.onerror = () => res();
              });
            }));

            // delay pequeno para estilos recalcularem
            setTimeout(() => {
              if (!done) {
                done = true;
                clearTimeout(timer);
                resolve();
              }
            }, 150);
          } catch (err) {
            if (!done) {
              done = true;
              clearTimeout(timer);
              reject(err);
            }
          }
        };
      });

      // 7) Captura com html2canvas
      const ifDoc = iframe.contentDocument || iframe.contentWindow.document;
      const targetEl = ifDoc.body;
      const scale = 2; // ajuste de qualidade (aumente para melhor resolução)
      const canvas = await html2canvas(targetEl, {
        scale: scale,
        useCORS: true,
        width: iframeWidthPx,
        height: iframeHeightPx,
        windowWidth: iframeWidthPx,
        windowHeight: iframeHeightPx,
        logging: false
      });

      // 8) Converte px->mm levando em conta 'scale' e DPI (assume 96 CSS px / inch)
      const dpi = 96;
      const pxToMm = 25.4 / (dpi * scale); // mm por canvas-pixel
      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const imgWidthMm = imgWidthPx * pxToMm;
      const imgHeightMm = imgHeightPx * pxToMm;

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // MARGENS (mm) - ajuste facilmente aqui
      const margemX = 5;
      const margemY = 5;

      const maxW = pageW - margemX * 2;
      const maxH = pageH - margemY * 2;
      const scaleRatio = Math.min(maxW / imgWidthMm, maxH / imgHeightMm);
      const finalW = imgWidthMm * scaleRatio;
      const finalH = imgHeightMm * scaleRatio;
      const posX = (pageW - finalW) / 2;
      const posY = (pageH - finalH) / 2;

      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", posX, posY, finalW, finalH);

      pdf.save(`${tipo}.pdf`);

      // remove iframe
      document.body.removeChild(iframe);

    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      alert("Erro ao gerar PDF. Veja o console (F12) para detalhes: " + (err && err.message ? err.message : err));
      // habilita botão novamente
      gerarBtn.disabled = false;
      gerarBtn.textContent = "Gerar PDF";
      return;
    }

    gerarBtn.disabled = false;
    gerarBtn.textContent = "Gerar PDF";
  });
});
