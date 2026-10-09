import heroImage from '../../assets/hero.png';

/**
 * Landing page hero image.
 *
 * This was previously a visible "Photo placeholder – ready for real image"
 * caption sitting behind a second decorative text overlay, so visitors saw two
 * overlapping slogans and a note that the site was unfinished. The real asset
 * (src/assets/hero.png) is used now, and the decorative overlay is gone.
 *
 * `object-cover` with a fixed aspect ratio keeps the layout stable while the
 * image loads, which is what the previous fixed-height div was doing by
 * accident.
 */
export default function HeroImagePlaceholder() {
  return (
    <figure className="w-full">
      <img
        src={heroImage}
        alt="People walking together, supporting someone who needs help."
        className="aspect-4/3 w-full rounded-card object-cover shadow-md sm:aspect-16/10"
        width={960}
        height={640}
        loading="eager"
        decoding="async"
      />
    </figure>
  );
}
