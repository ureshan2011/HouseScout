"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Listing, fmt } from "@/lib/api";

// Free OSM raster basemap — no API key required. Swap for the LINZ Basemaps style
// (https://basemaps.linz.govt.nz/) with a key for NZ aerial/topographic tiles.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const CHCH: [number, number] = [172.6362, -43.5321];

export function ListingsMap({ listings }: { listings: Listing[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: CHCH,
      zoom: 11,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const pts = listings.filter((l) => l.lat != null && l.lng != null);
    pts.forEach((l) => {
      const score = l.score?.match_score ?? 0;
      const color = score >= 60 ? "#059669" : score >= 45 ? "#d97706" : "#64748b";
      const el = document.createElement("div");
      el.style.cssText =
        `background:${color};color:#fff;font-size:11px;font-weight:600;border-radius:9999px;` +
        `padding:2px 6px;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;white-space:nowrap`;
      el.textContent = l.price ? `$${Math.round((l.price as number) / 1000)}k` : "POA";

      const popup = new maplibregl.Popup({ offset: 16 }).setHTML(
        `<div style="font-size:12px">
           <strong>${l.address ?? ""}</strong><br/>${l.suburb ?? ""}<br/>
           ${fmt.money(l.price)} · ${l.bedrooms ?? "?"}bd · score ${score.toFixed(0)}
         </div>`
      );
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([l.lng as number, l.lat as number])
        .setPopup(popup)
        .addTo(map);
      el.addEventListener("click", () => router.push(`/listings/${l.id}`));
      markersRef.current.push(marker);
    });

    if (pts.length) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((l) => b.extend([l.lng as number, l.lat as number]));
      map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
    }
  }, [listings, router]);

  return <div ref={ref} className="h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200" />;
}
