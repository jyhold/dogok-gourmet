// 마스코트 '도곡이' — 상태별 도트 캐릭터. PNG는 scripts/gen-mascot.mjs로 생성.

type MascotState = 'happy' | 'sad' | 'rain';

interface Props {
  state?: MascotState;
  size?: number;
  /** 통통 튀는 아이들 애니메이션 (로딩·인사) */
  bounce?: boolean;
}

export default function Mascot({ state = 'happy', size = 80, bounce = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={bounce ? 'mascot-sprite mascot-bounce' : 'mascot-sprite'}
      src={`/assets/mascot/mascot-${state}.png`}
      alt="도곡이 마스코트"
      width={size}
      height={size}
    />
  );
}
