import { cn } from '@/lib/utils'

/** Marca completa (IA / representación). */
export const JASWAVE_LOGO_SRC = '/jaswavelogo.png'
/** Icono de aplicación (ventana, rail, título). */
export const JASWAVE_APP_ICON_SRC = '/jaswave-icono-con-frecuencia.png'

export function JasWaveLogo({
  className,
  alt = 'JasWave',
}: {
  className?: string
  alt?: string
}) {
  return (
    <img
      src={JASWAVE_LOGO_SRC}
      alt={alt}
      className={cn('object-contain object-center', className)}
      draggable={false}
    />
  )
}

export function JasWaveAppIcon({
  className,
  alt = 'JasWave',
}: {
  className?: string
  alt?: string
}) {
  return (
    <img
      src={JASWAVE_APP_ICON_SRC}
      alt={alt}
      className={cn('object-contain object-center', className)}
      draggable={false}
    />
  )
}
