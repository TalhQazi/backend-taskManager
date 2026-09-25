const express = require("express");
const Itinerary = require("../models/Itinerary");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Helper to convert _id to id
function withId(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...obj, id: String(obj._id) };
}

// Haversine formula to compute distance in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// Standard TSP Optimization Solver (Nearest Neighbor + Haversine fallback)
function optimizeStopsNearestNeighbor(stops) {
  if (stops.length <= 1) {
    stops.forEach((stop, idx) => {
      stop.sequenceOrder = idx;
      stop.travelTimeToNext = 0;
    });
    return stops;
  }

  // We keep the first stop (Stop 0) in its place as the starting anchor
  const optimized = [stops[0]];
  const unvisited = stops.slice(1);

  while (unvisited.length > 0) {
    const current = optimized[optimized.length - 1];
    let nearestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistance(
        current.latitude,
        current.longitude,
        unvisited[i].latitude,
        unvisited[i].longitude
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }

    optimized.push(unvisited[nearestIndex]);
    unvisited.splice(nearestIndex, 1);
  }

  // Update sequenceOrder and calculate travel times
  optimized.forEach((stop, index) => {
    stop.sequenceOrder = index;
    if (index < optimized.length - 1) {
      const dist = haversineDistance(
        stop.latitude,
        stop.longitude,
        optimized[index + 1].latitude,
        optimized[index + 1].longitude
      );
      // Assume average city speed is 45 km/h (0.75 km/minute)
      stop.travelTimeToNext = Math.max(1, Math.round(dist / 0.75));
    } else {
      stop.travelTimeToNext = 0;
    }
  });

  return optimized;
}

// Dynamic routing using Google Maps Distance Matrix API if API Key is available
async function optimizeStopsWithGoogle(stops) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || stops.length <= 1) {
    return optimizeStopsNearestNeighbor(stops);
  }

  try {
    // Construct Google Distance Matrix API Query
    const origins = stops.map(s => `${s.latitude},${s.longitude}`).join("|");
    const destinations = stops.map(s => `${s.latitude},${s.longitude}`).join("|");
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&mode=driving&key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Maps API status: ${response.status}`);
    }

    const data = await response.json();
    if (data.status !== "OK" || !data.rows) {
      throw new Error(`Google Maps Distance Matrix response error: ${data.status}`);
    }

    // Solve TSP using Nearest Neighbor using actual Google travel times
    const optimized = [stops[0]];
    const unvisited = [...stops.slice(1)];
    const visitedIndices = new Set([0]);

    while (unvisited.length > 0) {
      const currentIdx = stops.indexOf(optimized[optimized.length - 1]);
      let nearestUnvisitedIdx = -1;
      let minDurationSecs = Infinity;

      for (let i = 0; i < stops.length; i++) {
        if (visitedIndices.has(i)) continue;

        // Fetch duration from current to candidate
        const element = data.rows[currentIdx]?.elements[i];
        const durationSecs = element?.status === "OK" ? element.duration.value : Infinity;

        if (durationSecs < minDurationSecs) {
          minDurationSecs = durationSecs;
          nearestUnvisitedIdx = i;
        }
      }

      if (nearestUnvisitedIdx === -1) {
        // Fallback in case of elements errors
        const next = unvisited.shift();
        optimized.push(next);
        visitedIndices.add(stops.indexOf(next));
      } else {
        const next = stops[nearestUnvisitedIdx];
        optimized.push(next);
        visitedIndices.add(nearestUnvisitedIdx);
        const idxInUnvisited = unvisited.indexOf(next);
        if (idxInUnvisited > -1) unvisited.splice(idxInUnvisited, 1);
      }
    }

    // Set travel times from Matrix API
    optimized.forEach((stop, index) => {
      stop.sequenceOrder = index;
      if (index < optimized.length - 1) {
        const currentIdxInOriginal = stops.indexOf(stop);
        const nextIdxInOriginal = stops.indexOf(optimized[index + 1]);
        const element = data.rows[currentIdxInOriginal]?.elements[nextIdxInOriginal];

        if (element && element.status === "OK") {
          // Convert seconds to minutes
          stop.travelTimeToNext = Math.max(1, Math.round(element.duration.value / 60));
        } else {
          // Haversine fallback for this segment
          const dist = haversineDistance(
            stop.latitude,
            stop.longitude,
            optimized[index + 1].latitude,
            optimized[index + 1].longitude
          );
          stop.travelTimeToNext = Math.max(1, Math.round(dist / 0.75));
        }
      } else {
        stop.travelTimeToNext = 0;
      }
    });

    return optimized;
  } catch (err) {
    console.error("[TSP Optimization Engine] Google API Failed. Falling back to local Haversine.", err.message);
    return optimizeStopsNearestNeighbor(stops);
  }
}

// Mapbox Optimization API implementation
async function optimizeStopsWithMapbox(stops) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token || stops.length <= 1) {
    return optimizeStopsNearestNeighbor(stops);
  }

  try {
    // Mapbox expects coordinates as lon,lat semicolon-separated
    const coords = stops.map(s => `${s.longitude},${s.latitude}`).join(";");
    // Keep start as first and end as last
    const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coords}?access_token=${token}&source=first&destination=last&roundtrip=false&overview=false&geometries=geojson`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Mapbox API status: ${response.status}`);
    const data = await response.json();

    // Determine optimized order
    let order = null;
    if (data.trips && data.trips.length > 0 && Array.isArray(data.trips[0].waypoint_order)) {
      order = data.trips[0].waypoint_order; // array of input indices in optimized order
    }

    if (!order) {
      // fallback: nearest neighbor
      return optimizeStopsNearestNeighbor(stops);
    }

    // Build optimized stops array by mapping order indices -> stops
    const optimized = order.map(idx => stops[idx]);

    // Set sequenceOrder and travelTimeToNext from legs if available
    if (data.trips && data.trips[0] && Array.isArray(data.trips[0].legs)) {
      const legs = data.trips[0].legs;
      optimized.forEach((stop, index) => {
        stop.sequenceOrder = index;
        if (index < optimized.length - 1) {
          const leg = legs[index];
          stop.travelTimeToNext = leg && leg.duration ? Math.max(1, Math.round(leg.duration / 60)) : 0;
        } else {
          stop.travelTimeToNext = 0;
        }
      });
    } else {
      // Fallback compute via haversine
      optimized.forEach((stop, index) => {
        stop.sequenceOrder = index;
        if (index < optimized.length - 1) {
          const dist = haversineDistance(
            stop.latitude,
            stop.longitude,
            optimized[index + 1].latitude,
            optimized[index + 1].longitude
          );
          stop.travelTimeToNext = Math.max(1, Math.round(dist / 0.75));
        } else {
          stop.travelTimeToNext = 0;
        }
      });
    }

    return optimized;
  } catch (err) {
    console.error("[TSP Optimization Engine] Mapbox API Failed. Falling back to local Haversine.", err.message);
    return optimizeStopsNearestNeighbor(stops);
  }
}

// Provider wrapper: choose Mapbox, Google, or fallback
async function optimizeStopsProvider(stops) {
  const provider = (process.env.ROUTING_PROVIDER || "google").toLowerCase();
  if (provider === "mapbox") {
    return await optimizeStopsWithMapbox(stops);
  }
  // Default to Google implementation which itself falls back
  return await optimizeStopsWithGoogle(stops);
}

// 1. GET ALL ITINERARIES OR FILTER BY EMPLOYEE & DATE
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { date, employeeId } = req.query;

    const query = {};
    if (date) query.date = date;
    if (employeeId) query.userId = employeeId;

    const itineraries = await Itinerary.find(query).lean();
    res.json({ items: itineraries.map(withId) });
  } catch (err) {
    next(err);
  }
});

// 2. GET CURRENT LOGGED IN EMPLOYEE'S ITINERARY FOR TODAY
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id; // current logged in employee's _id
    const clientDate = req.query.date; // e.g. "2026-05-22"

    // Default to server's date if client date not provided
    const dateQuery = clientDate || new Date().toISOString().split("T")[0];

    const itinerary = await Itinerary.findOne({ userId, date: dateQuery }).lean();
    if (!itinerary) {
      return res.json({ item: null });
    }

    res.json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

// 3. CREATE OR UPDATE AN ITINERARY FOR AN EMPLOYEE
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { userId, date, startTime, stops } = req.body;

    if (!userId || !date) {
      return res.status(400).json({ error: { message: "userId and date are required" } });
    }

    // Default sequence orders and base travel times
    const formattedStops = (stops || []).map((stop, index) => ({
      title: stop.title,
      address: stop.address || "",
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      estimatedDurationMinutes: Number(stop.estimatedDurationMinutes || 30),
      sequenceOrder: stop.sequenceOrder !== undefined ? Number(stop.sequenceOrder) : index,
      travelTimeToNext: Number(stop.travelTimeToNext || 0),
      taskId: stop.taskId || null,
      locationId: stop.locationId || null,
      completed: !!stop.completed,
      completedAt: stop.completedAt || null,
    }));

    // Find and update or create
    let itinerary = await Itinerary.findOne({ userId, date });

    if (itinerary) {
      itinerary.startTime = startTime || itinerary.startTime;
      itinerary.stops = formattedStops;
      itinerary.optimized = false; // reset optimized flag on edit
      await itinerary.save();
    } else {
      itinerary = await Itinerary.create({
        userId,
        date,
        startTime: startTime || "08:00",
        stops: formattedStops,
        optimized: false,
      });
    }

    res.status(201).json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

// 4. MANUAL STOP SEQUENCE OVERRIDE
router.put("/:id/stops/sequence", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stops } = req.body; // Array of stops with new sequenceOrder and coordinates

    if (!Array.isArray(stops)) {
      return res.status(400).json({ error: { message: "stops must be an array" } });
    }

    const itinerary = await Itinerary.findById(id);
    if (!itinerary) {
      return res.status(404).json({ error: { message: "Itinerary not found" } });
    }

    // Re-calculate travel time between consecutive stops in the manually-ordered array
    const ordered = [...stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    ordered.forEach((stop, index) => {
      stop.sequenceOrder = index;
      if (index < ordered.length - 1) {
        const dist = haversineDistance(
          stop.latitude,
          stop.longitude,
          ordered[index + 1].latitude,
          ordered[index + 1].longitude
        );
        stop.travelTimeToNext = Math.max(1, Math.round(dist / 0.75));
      } else {
        stop.travelTimeToNext = 0;
      }
    });

    itinerary.stops = ordered;
    itinerary.optimized = false; // Reset since it was manually rearranged
    await itinerary.save();

    res.json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

// 5. RUN OPTIMIZATION ENGINE (TSP SOLVER)
router.post("/:id/optimize", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const itinerary = await Itinerary.findById(id);
    if (!itinerary) {
      return res.status(404).json({ error: { message: "Itinerary not found" } });
    }

    // Run route optimizer using selected provider (MAPBOX or GOOGLE)
    const optimizedStops = await optimizeStopsProvider(itinerary.stops);

    itinerary.stops = optimizedStops;
    itinerary.optimized = true;
    await itinerary.save();

    res.json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

// 6. EMPLOYEE CHECK-IN / COMPLETE STOP
router.patch("/:id/stops/:stopId/complete", requireAuth, async (req, res, next) => {
  try {
    const { id, stopId } = req.params;
    const { completed } = req.body;

    const itinerary = await Itinerary.findById(id);
    if (!itinerary) {
      return res.status(404).json({ error: { message: "Itinerary not found" } });
    }

    const stop = itinerary.stops.id(stopId);
    if (!stop) {
      return res.status(404).json({ error: { message: "Stop not found in itinerary" } });
    }

    stop.completed = completed !== undefined ? !!completed : true;
    stop.completedAt = stop.completed ? new Date() : null;

    await itinerary.save();

    // Trigger Socket.io real-time update to any listening dashboards (e.g. managers)
    if (global.io) {
      global.io.to("manager").to("super-admin").to("admin").emit("itinerary-update", {
        itineraryId: id,
        userId: itinerary.userId,
        date: itinerary.date,
        stopId,
        completed: stop.completed,
      });
    }

    res.json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

// 7. GPS Ping / Live Tracking ingestion
router.post('/:id/location', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, reoptimize } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: { message: 'latitude and longitude required as numbers' } });
    }

    const itinerary = await Itinerary.findById(id);
    if (!itinerary) return res.status(404).json({ error: { message: 'Itinerary not found' } });

    // Update last known location
    itinerary.lastLocation = { latitude, longitude, updatedAt: new Date() };

    // Optionally re-optimize remaining stops from this current location
    if (reoptimize) {
      // Find completed and remaining stops
      const completed = itinerary.stops.filter(s => s.completed).sort((a,b)=>a.sequenceOrder - b.sequenceOrder);
      const remaining = itinerary.stops.filter(s => !s.completed).sort((a,b)=>a.sequenceOrder - b.sequenceOrder);

      if (remaining.length > 0) {
        // Build temp stops with pointer to original indices
        const temp = [{ latitude, longitude, __origIndex: null }];
        for (let i = 0; i < remaining.length; i++) {
          const s = remaining[i];
          temp.push({ latitude: s.latitude, longitude: s.longitude, __origIndex: i });
        }

        // Call provider optimizer
        const optimizedTemp = await optimizeStopsProvider(temp);

        // Map optimized order back to remaining stops
        const optimizedRemaining = [];
        for (const t of optimizedTemp) {
          if (t.__origIndex === null) continue; // skip current loc
          const orig = remaining[t.__origIndex];
          optimizedRemaining.push(orig);
        }

        // Merge completed + optimizedRemaining
        const merged = [...completed, ...optimizedRemaining];
        merged.forEach((s, idx) => (s.sequenceOrder = idx));
        // Recompute travelTimeToNext conservatively if missing
        merged.forEach((s, idx) => {
          if (idx < merged.length - 1) {
            const dist = haversineDistance(s.latitude, s.longitude, merged[idx + 1].latitude, merged[idx + 1].longitude);
            s.travelTimeToNext = Math.max(1, Math.round(dist / 0.75));
          } else {
            s.travelTimeToNext = 0;
          }
        });

        itinerary.stops = merged;
        itinerary.optimized = true;
      }
    }

    await itinerary.save();

    // Broadcast live update
    if (global.io) {
      global.io.to('manager').to('admin').emit('itinerary-location', {
        itineraryId: id,
        userId: itinerary.userId,
        latitude,
        longitude,
        reoptimized: !!reoptimize,
        timestamp: new Date()
      });
    }

    res.json({ item: withId(itinerary) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
