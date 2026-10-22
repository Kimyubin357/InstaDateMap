"use client";
import { useId } from "react";
export default function PinInput({ label = "여섯 자리 PIN", value, onChange, autoFocus = false }: { label?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  return <div className="pin-field"><label htmlFor={id}>{label}</label><div className="pin-control">
    <div className="pin-cells" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className={i === value.length ? "current" : ""}>{value[i] ? "●" : ""}</span>)}</div>
    <input id={id} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="off" autoFocus={autoFocus} required />
    </div></div>;
}
