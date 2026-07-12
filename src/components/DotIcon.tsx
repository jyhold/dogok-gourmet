import { iconPathForSub } from '@/lib/icons';

interface Props {
  sub: string;
  size?: number;
  /** 어두운 배경(슬롯 릴) 위에 올릴 때 밝은 도트 타일 배경 */
  tile?: boolean;
}

/** 16×16 도트 아이콘을 정수배 확대(pixelated)로 렌더 */
export default function DotIcon({ sub, size = 48, tile = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={tile ? 'dot-icon dot-icon-tile' : 'dot-icon'}
      src={iconPathForSub(sub)}
      alt={sub}
      width={size}
      height={size}
    />
  );
}
