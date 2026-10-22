"use client";
import { useEffect, useRef, useState } from "react";

interface Measurements {
  screen: string;
  viewport: string;
  visualViewport: string;
  map: string;
  safeTop: string;
  mode: string;
}

/** Replaces only the map's pixels, preserving the map's actual layout and clipping. */
export default function SafeAreaDiagnostic({ onClose }: { onClose: () => void }) {
  const pattern = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [measurements, setMeasurements] = useState<Measurements | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pattern.current || !probe.current) return;
        const rect = pattern.current.getBoundingClientRect(), visual = window.visualViewport;
        const round = (value: number) => Math.round(value * 10) / 10;
        const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia("(display-mode: standalone)").matches;
        const next = {
          screen: `${screen.width} × ${screen.height}`,
          viewport: `${innerWidth} × ${innerHeight}`,
          visualViewport: visual ? `${round(visual.height)} / 위 ${round(visual.offsetTop)}` : "지원하지 않음",
          map: `위 ${round(rect.top)} / 높이 ${round(rect.height)}`,
          safeTop: getComputedStyle(probe.current).paddingTop,
          mode: standalone ? "홈 화면 앱" : "브라우저",
        };
        setMeasurements((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      });
    };
    const observer = new ResizeObserver(measure);
    if (pattern.current) observer.observe(pattern.current);
    window.addEventListener("resize", measure); window.addEventListener("pageshow", measure);
    window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", measure); window.removeEventListener("pageshow", measure);
      window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, []);
  return <div ref={pattern} className="safe-area-diagnostic" aria-label="지도 영역 줄무늬 진단">
    <span ref={probe} className="safe-area-probe" aria-hidden="true" />
    <section className="safe-area-readout" aria-labelledby="safe-area-title">
      <h2 id="safe-area-title">노치 영역 확인</h2>
      <p>시간·배터리 뒤에도 줄무늬가 이어지는지 확인하고, 화면 전체를 캡처해 주세요.</p>
      <p className="hint">줄무늬는 실제 지도와 같은 영역에 표시돼요. 화면 크기를 바꾸는 보정은 적용하지 않았어요.</p>
      {measurements ? <dl>
        <dt>실행 방식</dt><dd>{measurements.mode}</dd>
        <dt>기기 화면</dt><dd>{measurements.screen}</dd>
        <dt>웹 화면</dt><dd>{measurements.viewport}</dd>
        <dt>보이는 화면 높이</dt><dd>{measurements.visualViewport}</dd>
        <dt>지도 영역</dt><dd>{measurements.map}</dd>
        <dt>상단 안전영역</dt><dd>{measurements.safeTop}</dd>
      </dl> : <p role="status">화면 크기를 확인하는 중…</p>}
      <button className="btn primary" onClick={onClose}>진단 끝내기</button>
    </section>
  </div>;
}
