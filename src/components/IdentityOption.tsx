import Image, { type StaticImageData } from "next/image";
import Icon from "./Icon";
import yubin from "../../public/illustrations/yubin.png";
import sumin from "../../public/illustrations/sumin.png";

const portraits = new Map<string, StaticImageData>([["유빈", yubin], ["수민", sumin]]);

export default function IdentityOption({ name, selected, disabled, onChoose }: { name: string; selected?: boolean; disabled: boolean; onChoose: () => void }) {
  const portrait = portraits.get(name.normalize("NFC").trim());
  return <button type="button" className={`identity-option person-${portrait === sumin ? 1 : 0}`} disabled={disabled} aria-pressed={selected} onClick={onChoose}>
    {portrait ? <Image className="identity-portrait" src={portrait} alt="" sizes="96px" /> : <span className="identity-portrait identity-fallback" aria-hidden="true"><Icon name="user" width="44" /></span>}
    <span className="identity-name">{name}</span>
  </button>;
}
