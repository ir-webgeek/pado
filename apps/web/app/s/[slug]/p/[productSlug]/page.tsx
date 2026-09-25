import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VariantPicker, type PublicVariant } from "@/components/store/add-to-cart";
import { publicGet } from "@/lib/server-api";

interface ProductResp {
  product: { id: string; title: string; description: string; images: string[]; seoTitle: string | null; seoDescription: string | null; variants: PublicVariant[] };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productSlug: string }> }): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const data = await publicGet<ProductResp>(`/shops/${slug}/products/${productSlug}`);
  if (!data) return {};
  const p = data.product;
  return { title: p.seoTitle ?? p.title, description: p.seoDescription ?? p.description.slice(0, 160), openGraph: { images: p.images.slice(0, 1) } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; productSlug: string }> }) {
  const { slug, productSlug } = await params;
  const data = await publicGet<ProductResp>(`/shops/${slug}/products/${productSlug}`, 10);
  if (!data) notFound();
  const p = data.product;
  const minPrice = Math.min(...p.variants.map((v) => v.price));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description,
    image: p.images,
    offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: minPrice * 10, availability: p.variants.some((v) => v.available > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="grid gap-3">
        {p.images.length ? (
          p.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={p.title} className="w-full rounded-3xl object-cover" loading={i ? "lazy" : "eager"} />
          ))
        ) : (
          <div className="aspect-square rounded-3xl bg-[var(--surface-sunken)]" />
        )}
      </div>
      <div className="md:sticky md:top-24 md:self-start">
        <h1 className="text-2xl font-bold strong sm:text-3xl">{p.title}</h1>
        <div className="mt-4">
          <VariantPicker title={p.title} image={p.images[0]} variants={p.variants} />
        </div>
        {p.description && <p className="mt-8 whitespace-pre-line leading-8 muted">{p.description}</p>}
      </div>
    </div>
  );
}
