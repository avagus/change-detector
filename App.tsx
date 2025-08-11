"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, ImageOverlay, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Map as MapIcon, PlayCircle, Settings2, Pencil, Check, X } from "lucide-react";
import { motion } from "framer-motion";

// =====================
// Lightweight UI Primitives (no path aliases)
// =====================
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-neutral-200 rounded-2xl ${className}`}>{children}</div>;
}
function CardContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
function Button(
  { children, className = "", variant = "default", disabled, onClick }:
  { children: React.ReactNode; className?: string; variant?: "default" | "outline" | "secondary"; disabled?: boolean; onClick?: () => void }
) {
  const base = "inline-flex items-center justify-center px-3 py-2 text-sm rounded-xl transition-colors select-none";
  const styles = variant === "outline"
    ? "border border-neutral-300 bg-white hover:bg-neutral-50"
    : variant === "secondary"
    ? "bg-neutral-200 hover:bg-neutral-300"
    : "bg-blue-600 text-white hover:bg-blue-700";
  const disabledCls = disabled ? "opacity-60 cursor-not-allowed" : "";
  return (
    <button className={`${base} ${styles} ${disabledCls} ${className}`} onClick={disabled ? undefined : onClick}>
      {children}
    </button>
  );
}
function Input(
  { value, onChange, type = "text", className = "" }:
  { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; className?: string }
) {
  return <input type={type} value={value} onChange={onChange} className={`w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm ${className}`} />;
}
function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <span className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${checked ? "bg-blue-600" : "bg-neutral-300"}`}>
        <span className={`bg-white w-4 h-4 rounded-full transform transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}></span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e)=>onCheckedChange(e.target.checked)} className="hidden" />
    </label>
  );
}
function Slider({ value, onChange, min = 0, max = 100, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>onChange(Number(e.target.value))}
      className="w-full" />
  );
}

// =====================
// Types & Constants
// =====================
type LatLng = [number, number];
type Bounds = [[number, number], [number, number]];
const SAFE_CENTER: LatLng = [34.05, -118.25]; // Fallback center (Los Angeles)

// Backend base URL (set VITE_BACKEND_URL in your env for production)
const BACKEND: string = (import.meta as any)?.env?.VITE_BACKEND_URL || "http://localhost:8080";

// =====================
// Helpers
// =====================
function computeCenter(pts: LatLng[] | null | undefined, fallback: LatLng = SAFE_CENTER): LatLng {
  if (!pts || pts.length === 0) return fallback;
  const n = pts.length;
  let lat = 0, lng = 0;
  for (const [la, lo] of pts) { lat += la; lng += lo; }
  const cLat = lat / n, cLng = lng / n;
  return [Number.isFinite(cLat) ? cLat : fallback[0], Number.isFinite(cLng) ? cLng : fallback[1]];
}
function normalizeBounds(bbox: { north: number; south: number; east: number; west: number }): Bounds {
  // Ensure non-zero-area bounds; pad if degenerate
  let { north, south, east, west } = bbox;
  const minPad = 1e-4; // ~11m lat, ~9m lon at mid-lat
  if (!Number.isFinite(north) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(west)) {
    // fallback to a small box around SAFE_CENTER
    const [clat, clng] = SAFE_CENTER;
    north = clat + minPad; south = clat - minPad; east = clng + minPad; west = clng - minPad;
  }
  if (north === south) { north += minPad; south -= minPad; }
  if (east === west) { east += minPad; west -= minPad; }
  return [[south, west], [north, east]];
}
function polygonRoughAreaKm2(poly: LatLng[]): number {
  // Equirectangular approximation; suitable for small AOIs
  if (!poly || poly.length < 3) return 0;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const meanLat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const mPerDegLat = 111_132; // avg
  const mPerDegLon = 111_320 * Math.cos(toRad(meanLat));
  const pts = poly.map(([lat, lon]) => [lon * mPerDegLon, lat * mPerDegLat]);
  let areaM2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    areaM2 += (x1 * y2 - x2 * y1);
  }
  return Math.abs(areaM2) / 2 / 1e6; // km^2
}

// -------- In-browser self-tests (not formal unit tests, but basic guards) --------
if (typeof window !== "undefined" && import.meta.env.MODE !== "production") {
  // computeCenter fallbacks
  const c0 = computeCenter([] as LatLng[], [1, 2]);
  console.assert(c0[0] === 1 && c0[1] === 2, `computeCenter fallback failed: ${c0}`);
  const c1 = computeCenter([[0, 0], [2, 2]]);
  console.assert(Math.abs(c1[0] - 1) < 1e-9 && Math.abs(c1[1] - 1) < 1e-9, `computeCenter average failed: ${c1}`);
  // area approx sanity
  const sq: LatLng[] = [[34.05,-118.25],[34.06,-118.25],[34.06,-118.24],[34.05,-118.24]];
  const a = polygonRoughAreaKm2(sq);
  console.assert(a > 8 && a < 15, `Area self-test: expected ~11±3 km², got ${a}`);
}

// =====================
// Backend wiring (ndvi-backend)
// =====================
function closeRingIfNeeded(points: LatLng[]): [number, number][][] {
  // GeoJSON wants [ [ [lng,lat], ... , first ] ]
  const ring = points.map(([lat, lng]) => [lng, lat]);
  if (ring.length >= 1) {
    const [f0, f1] = ring[0];
    const [l0, l1] = ring[ring.length - 1];
    if (f0 !== l0 || f1 !== l1) ring.push([f0, f1]);
  }
  return [ring as [number, number][]];
}

async function fetchNdviChange(params: {
  aoi: LatLng[];
  before: string;
  after: string;
  cloudMask: boolean;
}): Promise<{
  overlayUrl: string;
  bounds: Bounds;
  summary: { mean_delta: number; pct_gain_pixels: number; pct_loss_pixels: number };
}> {
  const coordinates = closeRingIfNeeded(params.aoi);
  const body = {
    aoi_geojson: { type: "Polygon", coordinates },
    before_date: params.before,
    after_date: params.after,
    cloud_mask: params.cloudMask,
  };
  const res = await fetch(`${BACKEND}/ndvi-change`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"(no body)");
    throw new Error(`Backend ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const overlayUrl = `${BACKEND}${data.overlay_url}`;
  const b = data.bounds as [[number, number],[number, number]];
  return { overlayUrl, bounds: b, summary: data.summary };
}

// =====================
// Leaflet helpers
// =====================
function FitBounds({ bounds }: { bounds: Bounds | null }) {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [24, 24] }); }, [bounds, map]);
  return null;
}
function MapClickCapture({ drawing, onAddPoint }: { drawing: boolean; onAddPoint: (ll: LatLng) => void }) {
  useMapEvents({ click(e) { if (drawing) onAddPoint([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

// =====================
// Main Component
// =====================
export default function App() {
  // Default AOI (simple rectangle in LA)
  const [aoi, setAoi] = useState<LatLng[]>([
    [34.0522, -118.2437],
    [34.0622, -118.2437],
    [34.0622, -118.2237],
    [34.0522, -118.2237],
  ]);
  const [draftAoi, setDraftAoi] = useState<LatLng[]>([]);
  const [drawing, setDrawing] = useState(false);

  const [before, setBefore] = useState<string>(new Date(Date.now() - 1000*60*60*24*30).toISOString().slice(0,10));
  const [after, setAfter] = useState<string>(new Date().toISOString().slice(0,10));
  const [cloudMask, setCloudMask] = useState(true);
  const [threshold, setThreshold] = useState(30);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBounds, setResultBounds] = useState<Bounds | null>(null);
  const [summary, setSummary] = useState<{ changedPct: number; totalAreaKm2: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Robust center: prefer draftAoi if drawing, else aoi; fallback to SAFE_CENTER
  const mapCenter: LatLng = useMemo(() => {
    const tgt = (drawing && draftAoi.length > 0) ? draftAoi : aoi;
    return computeCenter(tgt, SAFE_CENTER);
  }, [aoi, draftAoi, drawing]);

  const startDrawing = () => { setDraftAoi([]); setDrawing(true); };
  const addPoint = (ll: LatLng) => setDraftAoi(prev => [...prev, ll]);
  const finishDrawing = () => { if (draftAoi.length >= 3) setAoi(draftAoi); setDraftAoi([]); setDrawing(false); };
  const cancelDrawing = () => { setDraftAoi([]); setDrawing(false); };

  const runAnalysis = async () => {
    const poly = (aoi && aoi.length >= 3) ? aoi : draftAoi;
    if (!poly || poly.length < 3) { setErrorMsg("Please draw a polygon with at least 3 points."); return; }
    setLoading(true);
    setErrorMsg(null);
    setResultUrl(null); setSummary(null); setResultBounds(null);
    try {
      const res = await fetchNdviChange({ aoi: poly, before, after, cloudMask });
      setResultUrl(res.overlayUrl);
      setResultBounds(res.bounds);
      // Keep placeholder metrics (AOI size) and add real NDVI stats in the panel below
      setSummary({ changedPct: Math.abs(res.summary.mean_delta) * 100, totalAreaKm2: polygonRoughAreaKm2(poly) });
      (window as any).__NDVI_SUMMARY__ = res.summary;
    } catch (err: any) {
      setErrorMsg(err?.message || "Request failed");
    } finally { setLoading(false); }
  };

  const reset = () => { setResultUrl(null); setSummary(null); setResultBounds(null); setErrorMsg(null); };

  return (
    <div className="w-full h-screen grid grid-cols-12 gap-3 p-3 bg-neutral-50">
      {/* Sidebar */}
      <div className="col-span-4 xl:col-span-3 space-y-3">
        <Card className="shadow-md">
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <MapIcon className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Area of Interest</h2>
            </div>
            <p className="text-sm text-neutral-600">Draw a polygon on the map (toggle drawing), or use the default box. We’ll fetch imagery and highlight NDVI changes between your selected dates.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-600">Before date</label>
                <Input type="date" value={before} onChange={(e)=>setBefore(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-neutral-600">After date</label>
                <Input type="date" value={after} onChange={(e)=>setAfter(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                <span className="text-sm">Cloud mask</span>
              </div>
              <Switch checked={cloudMask} onCheckedChange={setCloudMask} />
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span>Change threshold (UI only)</span>
                <span className="text-neutral-500">{threshold}%</span>
              </div>
              <Slider value={threshold} onChange={setThreshold} min={0} max={100} step={1} />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button variant={drawing ? "secondary" : "default"} onClick={startDrawing} disabled={drawing}>
                <Pencil className="w-4 h-4 mr-2" /> Draw AOI
              </Button>
              <Button variant="outline" onClick={finishDrawing} disabled={!drawing || draftAoi.length < 3}>
                <Check className="w-4 h-4 mr-2" /> Finish
              </Button>
              <Button variant="outline" onClick={cancelDrawing} disabled={!drawing}>
                <X className="w-4 h-4 mr-2" /> Cancel
              </Button>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="w-full" onClick={runAnalysis} disabled={loading}>
                <PlayCircle className="w-4 h-4 mr-2" /> {loading ? "Analyzing…" : "Run analysis"}
              </Button>
              <Button variant="outline" onClick={reset}>Reset</Button>
            </div>
            {summary && (
              <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="text-sm font-semibold">Summary</div>
                <div className="text-sm text-neutral-700">(UI) AOI size (rough): {summary.totalAreaKm2.toFixed(2)} km²</div>
                <div className="text-sm text-neutral-700">(UI) |ΔNDVI| proxy: {summary.changedPct.toFixed(1)}%</div>
                <div className="text-xs text-neutral-600 mt-2">
                  Real stats: mean ΔNDVI={(window as any)?.__NDVI_SUMMARY__?.mean_delta?.toFixed?.(3) ?? "–"}, gain%={(window as any)?.__NDVI_SUMMARY__?.pct_gain_pixels?.toFixed?.(1) ?? "–"}, loss%={(window as any)?.__NDVI_SUMMARY__?.pct_loss_pixels?.toFixed?.(1) ?? "–"}
                </div>
              </motion.div>
            )}
            {errorMsg && (
              <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-sm text-red-700">{errorMsg}</div>
            )}
            <div className="text-[11px] text-neutral-500">Backend: {BACKEND}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <div className="text-sm font-semibold">How to use</div>
            <ul className="text-sm text-neutral-700 list-disc pl-5 space-y-1">
              <li>Click <b>Draw AOI</b>, then click on the map to add polygon vertices.</li>
              <li>Click <b>Finish</b> to set the AOI (needs ≥ 3 points).</li>
              <li>Pick two dates; we’ll compare imagery between them.</li>
              <li>Toggle cloud mask and threshold to refine results.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Map panel */}
      <div className="col-span-8 xl:col-span-9">
        <Card className="h-full overflow-hidden">
          <div className="h-full w-full relative">
            <MapContainer center={mapCenter} zoom={12} className="h-full w-full">
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* AOI polygons */}
              {aoi?.length >= 3 && (
                <Polygon positions={aoi} pathOptions={{ color: "#0ea5e9", weight: 2, fillOpacity: 0.08 }} />
              )}
              {draftAoi?.length >= 2 && (
                <Polygon positions={draftAoi} pathOptions={{ color: "#8b5cf6", weight: 2, dashArray: "6,4", fillOpacity: 0.05 }} />
              )}

              {/* Change overlay */}
              {resultUrl && resultBounds && (
                <>
                  <ImageOverlay url={resultUrl} bounds={resultBounds} opacity={0.85} />
                  <FitBounds bounds={resultBounds} />
                </>
              )}

              {/* Click capture for drawing */}
              <MapClickCapture drawing={drawing} onAddPoint={(ll)=>setDraftAoi(prev=>[...prev, ll])} />
            </MapContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
