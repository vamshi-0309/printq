import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = process.env.NEXT_PUBLIC_APP_URL || "https://printq.in";
  const pages = [
    "",
    "/how-it-works",
    "/features",
    "/for-shops",
    "/pricing",
    "/faq",
    "/contact",
    "/privacy",
    "/terms",
  ];
  return pages.map((path) => ({
    url: `${url}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
