"use client";

import { useEffect, useRef, useState } from "react";

let pdfjsLoadPromise = null;
const PDFJS_VERSION = "6.2.108";
const PDFJS_CDN_BASE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;

function loadPdfjsLib(basePath) {
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfjsLoadPromise.then((nextPdfjsLib) => {
    nextPdfjsLib.GlobalWorkerOptions.workerSrc = `${basePath}/pdf.worker.min.mjs`;
    return nextPdfjsLib;
  });
}

export default function ReportSlideshow({
  report,
  reports = [],
  selectedReportFileName = "",
  onClose,
  onReportChange,
}) {
  const canvasRef = useRef(null);
  const transitionCanvasRef = useRef(null);
  const frameRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const [pdfjsLib, setPdfjsLib] = useState(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isPageReady, setIsPageReady] = useState(false);
  const [isTransitionVisible, setIsTransitionVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!report) {
      return undefined;
    }

    let isCancelled = false;
    const basePath = report.url.split("/data/")[0];

    setIsLoading(true);

    loadPdfjsLib(basePath)
      .then((nextPdfjsLib) => {
        if (isCancelled) {
          return;
        }

        setPdfjsLib(nextPdfjsLib);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setErrorMessage(error.message);
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [report]);

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return undefined;
    }

    const updateFrameWidth = () => {
      setFrameWidth(frame.clientWidth);
    };

    updateFrameWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFrameWidth);

      return () => {
        window.removeEventListener("resize", updateFrameWidth);
      };
    }

    const observer = new ResizeObserver(updateFrameWidth);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!report || !pdfjsLib) {
      setPdfDocument(null);
      setPageCount(0);
      setPageNumber(1);
      setIsPageReady(false);
      return undefined;
    }

    let isCancelled = false;
    let loadedDocument = null;
    const assetBasePath = report.url.split("/data/")[0];
    const loadingTask = pdfjsLib.getDocument({
      url: report.url,
      cMapPacked: true,
      cMapUrl: `${PDFJS_CDN_BASE_URL}/cmaps/`,
      standardFontDataUrl: `${PDFJS_CDN_BASE_URL}/standard_fonts/`,
      wasmUrl: `${PDFJS_CDN_BASE_URL}/wasm/`,
    });

    setIsLoading(true);
    setErrorMessage("");
    setPdfDocument(null);
    setPageCount(0);
    setPageNumber(1);
    setIsPageReady(false);

    loadingTask.promise
      .then((nextDocument) => {
        if (isCancelled) {
          nextDocument.destroy?.();
          return;
        }

        loadedDocument = nextDocument;
        setPdfDocument(nextDocument);
        setPageCount(nextDocument.numPages);
        setIsLoading(false);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setErrorMessage(error.message);
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
      loadingTask.destroy?.();

      if (typeof loadedDocument?.destroy === "function") {
        loadedDocument.destroy();
      } else if (typeof loadedDocument?.cleanup === "function") {
        loadedDocument.cleanup();
      }
    };
  }, [pdfjsLib, report]);

  useEffect(
    () => () => {
      window.clearTimeout(transitionTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!pdfDocument || !frameWidth || !canvasRef.current) {
      return undefined;
    }

    let isCancelled = false;
    let renderTask = null;

    const renderPage = async () => {
      setIsRendering(true);
      setErrorMessage("");

      try {
        const page = await pdfDocument.getPage(pageNumber);

        if (
          isCancelled ||
          !canvasRef.current ||
          !transitionCanvasRef.current
        ) {
          return;
        }

        const devicePixelRatio = window.devicePixelRatio || 1;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (frameWidth * devicePixelRatio) / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const nextCanvas = document.createElement("canvas");
        const nextContext = nextCanvas.getContext("2d");

        nextCanvas.width = Math.floor(viewport.width);
        nextCanvas.height = Math.floor(viewport.height);

        renderTask = page.render({
          canvasContext: nextContext,
          viewport,
        });

        await renderTask.promise;

        if (!isCancelled && canvasRef.current) {
          const currentCanvas = canvasRef.current;
          const currentContext = currentCanvas.getContext("2d");
          const transitionCanvas = transitionCanvasRef.current;
          const transitionContext = transitionCanvas.getContext("2d");
          const isInitialRender = !isPageReady;

          transitionCanvas.width = nextCanvas.width;
          transitionCanvas.height = nextCanvas.height;
          transitionContext.clearRect(
            0,
            0,
            transitionCanvas.width,
            transitionCanvas.height,
          );
          transitionContext.drawImage(nextCanvas, 0, 0);

          window.clearTimeout(transitionTimerRef.current);
          setIsTransitionVisible(false);

          requestAnimationFrame(() => {
            if (isCancelled) {
              return;
            }

            setIsTransitionVisible(true);
          });

          transitionTimerRef.current = window.setTimeout(
            () => {
              if (isCancelled) {
                return;
              }

              currentCanvas.width = nextCanvas.width;
              currentCanvas.height = nextCanvas.height;
              currentContext.clearRect(
                0,
                0,
                currentCanvas.width,
                currentCanvas.height,
              );
              currentContext.drawImage(nextCanvas, 0, 0);
              setIsTransitionVisible(false);
              setIsPageReady(true);
              setIsRendering(false);
            },
            isInitialRender ? 180 : 240,
          );
        }
      } catch (error) {
        if (isCancelled || error.name === "RenderingCancelledException") {
          return;
        }

        setErrorMessage(error.message);
        setIsRendering(false);
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      window.clearTimeout(transitionTimerRef.current);

      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [frameWidth, pageNumber, pdfDocument]);

  if (!report) {
    return null;
  }

  const canGoPrevious = pageNumber > 1;
  const canGoNext = pageCount > 0 && pageNumber < pageCount;
  const statusText = pageCount ? `${pageNumber} / ${pageCount}` : "- / -";
  const shouldShowInitialOverlay = isLoading || (!isPageReady && isRendering);

  return (
    <section className="reportViewer" aria-label="보고서 슬라이드쇼">
      <div className="reportViewerHeader">
        <div className="reportTitleGroup">
          <h2 id="report-modal-title">{report.label}</h2>
          <label className="reportSelectField reportModalSelectField">
            <span className="visuallyHidden">보고서 선택</span>
            <select
              className="reportSelect"
              disabled={!reports.length}
              value={selectedReportFileName}
              onChange={(event) => onReportChange?.(event.target.value)}
            >
              {reports.map((reportOption) => (
                <option
                  key={reportOption.fileName}
                  value={reportOption.fileName}
                >
                  {reportOption.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="reportControls">
          <button
            className="secondaryButton reportNavButton"
            disabled={!canGoPrevious || isLoading || isRendering}
            type="button"
            onClick={() => setPageNumber((currentPage) => currentPage - 1)}
          >
            이전
          </button>
          <span className="reportPageIndicator" aria-live="polite">
            {statusText}
          </span>
          <button
            className="secondaryButton reportNavButton"
            disabled={!canGoNext || isLoading || isRendering}
            type="button"
            onClick={() => setPageNumber((currentPage) => currentPage + 1)}
          >
            다음
          </button>
          <button
            className="secondaryButton reportCloseButton"
            type="button"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>

      <div className="reportFrame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          aria-label={`${report.label} ${pageNumber}페이지`}
          className="reportCanvas"
        />
        <canvas
          ref={transitionCanvasRef}
          aria-hidden="true"
          className={`reportCanvas reportTransitionCanvas${
            isTransitionVisible ? " visible" : ""
          }`}
        />
        {shouldShowInitialOverlay ? (
          <div className="reportOverlay" aria-live="polite">
            보고서를 준비하는 중입니다
          </div>
        ) : null}
        {errorMessage ? (
          <div className="reportOverlay reportError" role="alert">
            보고서를 표시하지 못했습니다: {errorMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
