import { useState, type CSSProperties } from "react";
import type { BoardTeam } from "@flow/core";

/** Dark-mode variant of a league logo URL, when the source publishes one. */
function darkVariant(url: string): string {
  if (url.includes("espncdn.com") && url.includes("/500/")) return url.replace("/500/", "/500-dark/");
  if (url.includes("assets.nhle.com") && url.includes("_light.")) return url.replace("_light.", "_dark.");
  return url;
}

export function TeamLogo({ team, size = 24 }: { team: BoardTeam | undefined; size?: number }) {
  const [failed, setFailed] = useState<{ lt?: boolean; dk?: boolean }>({});
  const style = { "--s": `${size}px`, "--tc": team?.color ?? "var(--line-2)" } as CSSProperties;
  if (!team) return <span className="logo mono" style={style} aria-hidden="true" />;
  if (!team.logo || (failed.lt && failed.dk)) {
    return (
      <span className="logo mono" style={style} aria-hidden="true">
        {team.code.slice(0, 3)}
      </span>
    );
  }
  const dark = darkVariant(team.logo);
  return (
    <span className="logo" style={style} aria-hidden="true">
      <img
        className="lt"
        src={team.logo}
        alt=""
        loading="lazy"
        onError={() => setFailed((f) => ({ ...f, lt: true }))}
      />
      <img
        className="dk"
        src={failed.dk ? team.logo : dark}
        alt=""
        loading="lazy"
        onError={() => setFailed((f) => ({ ...f, dk: true }))}
      />
    </span>
  );
}

export function TeamPair({ away, home, size = 24 }: { away?: BoardTeam; home?: BoardTeam; size?: number }) {
  return (
    <span className="pair">
      <TeamLogo team={away} size={size} />
      <TeamLogo team={home} size={size} />
    </span>
  );
}
