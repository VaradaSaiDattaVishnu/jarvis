import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * A REAL external-API tool — no key required (Open-Meteo).
 *
 * Two network calls: geocode the place name to coordinates, then fetch current
 * conditions. Every external call is guarded so a failure becomes a friendly
 * message the model can relay — never an unhandled exception that crashes the turn.
 *
 * Node's `fetch` types `response.json()` as `unknown` (it can't know a remote
 * shape), so we assert the fields we rely on. The runtime guards below still
 * handle a missing place or a non-OK response.
 */
export const getWeather = tool(
  async ({ location }) => {
    // 1) Geocode the place name → latitude / longitude.
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return `Could not look up "${location}" (HTTP ${geoRes.status}).`;
    const geo = (await geoRes.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; country: string }>;
    };
    const place = geo.results?.[0];
    if (!place) return `I couldn't find a place called "${location}".`;

    // 2) Fetch current conditions for those coordinates.
    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m`;
    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) return `Could not get the weather for ${place.name} (HTTP ${wxRes.status}).`;
    const wx = (await wxRes.json()) as {
      current: { temperature_2m: number; wind_speed_10m: number };
    };

    return `Weather in ${place.name}, ${place.country}: ${wx.current.temperature_2m}°C, wind ${wx.current.wind_speed_10m} km/h.`;
  },
  {
    name: "get_weather",
    description:
      "Get the current weather for a city or place. Use this for any question about current weather or temperature somewhere.",
    schema: z.object({
      location: z.string().describe("City or place name, e.g. 'Paris' or 'Tokyo, Japan'"),
    }),
  },
);
