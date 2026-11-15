/**
 * Team logo (source art: assets-src/teamname.png, served as public/teamname.webp). The source art sits on near-black, so `screen` blending
 * drops the backdrop and leaves only the chrome lettering + orbit arc.
 */
export function Wordmark({ height = 40, className = '' }: { height?: number; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height, aspectRatio: '2.3 / 1' }} role="img" aria-label="AreA 51">
      <img
        src="/teamname.webp"
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          height: '150%',
          width: 'auto',
          transform: 'translate(-50%, -50%)',
          mixBlendMode: 'screen',
          maskImage: 'radial-gradient(ellipse 60% 55% at 50% 50%, #000 62%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 50%, #000 62%, transparent 100%)',
        }}
      />
    </div>
  )
}

