import { useProxiedImage } from '../hooks/useProxiedImage'

interface ProxiedImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  proxySrc: string | null | undefined
}

/**
 * Image component that proxies its src through the main process.
 * Use this for any external images that might be blocked by CSP/CORS.
 */
export default function ProxiedImg({ proxySrc, alt, ...rest }: ProxiedImgProps) {
  const dataUri = useProxiedImage(proxySrc)
  if (!dataUri) return null
  return <img src={dataUri} alt={alt || ''} {...rest} />
}
