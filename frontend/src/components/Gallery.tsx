import { ChevronLeft, ChevronRight, Grid2x2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = photos.slice(0, 5);
  const n = shown.length;
  return (
    <>
      <div className={`gallery ${n === 1 ? "n1" : n === 2 ? "n2" : ""}`} style={n === 3 ? { gridTemplateColumns: "2fr 1fr" } : undefined}>
        {shown.map((p, i) => (
          <button key={p} onClick={() => setOpen(i)} aria-label={`Photo ${i + 1} of ${photos.length}`} style={n === 3 && i > 0 ? {} : undefined}>
            <img src={p} alt={i === 0 ? title : ""} loading={i === 0 ? "eager" : "lazy"} />
          </button>
        ))}
        {photos.length > 1 && (
          <span className="all">
            <button className="btn btn-sm btn-on-image" onClick={() => setOpen(0)}>
              <Grid2x2 /> {photos.length} photos
            </button>
          </span>
        )}
      </div>
      {open !== null && <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function Lightbox({ photos, start, onClose }: { photos: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true">
      <div className="lightbox-top">
        <span className="num">
          {i + 1} / {photos.length}
        </span>
        <button className="icon-btn" style={{ color: "#fff" }} onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>
      <div className="lightbox-stage">
        <img key={photos[i]} src={photos[i]} alt="" />
        {photos.length > 1 && (
          <>
            <button className="nav prev" onClick={() => go(-1)} aria-label="Previous">
              <ChevronLeft />
            </button>
            <button className="nav next" onClick={() => go(1)} aria-label="Next">
              <ChevronRight />
            </button>
          </>
        )}
      </div>
      <div className="lightbox-strip">
        {photos.map((p, k) => (
          <button key={p} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Photo ${k + 1}`}>
            <img src={p.replace(/-1600\.webp$/, "-720.webp")} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
