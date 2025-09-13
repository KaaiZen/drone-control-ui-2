import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// --- Custom Icons & Map Helpers ---

const droneIcon = new L.Icon({
  iconUrl: 'https://img.icons8.com/ios-filled/50/000000/drone.png',
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

const createWaypointIcon = (number) => {
  return new L.divIcon({
    className: 'custom-waypoint-icon',
    html: `<div class="bg-purple-700 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold border-2 border-white shadow-lg">${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

// --- Helper Functions for Calculations ---
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // in metres
};

const getBearing = (lat1, lon1, lat2, lon2) => {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const λ1 = lon1 * Math.PI / 180;
    const λ2 = lon2 * Math.PI / 180;
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
};

const toCardinal = (angle) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(angle / 45) % 8];
};


// --- UI Components ---
function MapController() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

const BatteryIcon = ({ level }) => {
  const charge = level > 75 ? '🟩' : level > 40 ? '🟨' : '🟥';
  return <span className="font-mono">{charge} {level}%</span>;
};
const SignalIcon = ({ strength }) => <span className="font-mono">📶 {strength}%</span>;
const CopyIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;


// --- Main Application Component ---
export default function App() {
  // --- State Management ---
  const predictedPath = useMemo(() => [
    [12.8238, 80.0421], // Waypoint 1
    [12.8260, 80.0450], // Waypoint 2
    [12.8285, 80.0430], // Waypoint 3
    [12.8275, 80.0410]  // Waypoint 4
  ], []);

  const startPoint = predictedPath[0];

  const [droneData, setDroneData] = useState({
    battery: 98, signal: 95, currentLat: startPoint[0], currentLon: startPoint[1],
    altitude: 50, speed: 25, videoStatus: 'Connecting...', objectDetected: 'None',
    heading: 'N', isLive: false,
  });

  const [actualPath, setActualPath] = useState([startPoint]);
  const [jsonData, setJsonData] = useState('');
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [copyStatusText, setCopyStatusText] = useState('Copy');

  const videoRef = useRef(null);
  const modalVideoRef = useRef(null);
  const flightIntervalRef = useRef(null);

  // Pre-calculate path distances
  const pathData = useMemo(() => {
    const segments = [];
    let totalDistance = 0;
    for (let i = 0; i < predictedPath.length - 1; i++) {
        const from = predictedPath[i];
        const to = predictedPath[i+1];
        const distance = getDistance(from[0], from[1], to[0], to[1]);
        const midpoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
        totalDistance += distance;
        segments.push({ distance, midpoint });
    }
    return { segments, totalDistance };
  }, [predictedPath]);

  // --- Laptop Camera & Flight Simulation ---
  useEffect(() => {
    let stream;
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setDroneData(prev => ({ ...prev, videoStatus: 'Connected', isLive: true }));
      })
      .catch(err => {
        console.error("Camera Error:", err);
        setDroneData(prev => ({ ...prev, videoStatus: 'Error', isLive: false }));
      });

    let waypointIndex = 1;
    let currentActualPath = [startPoint];

    flightIntervalRef.current = setInterval(() => {
      if (waypointIndex >= predictedPath.length) {
        clearInterval(flightIntervalRef.current);
        return;
      }

      setDroneData(prevData => {
        const currentPos = { lat: prevData.currentLat, lon: prevData.currentLon };
        const targetPos = { lat: predictedPath[waypointIndex][0], lon: predictedPath[waypointIndex][1] };
        
        const dx = targetPos.lon - currentPos.lon;
        const dy = targetPos.lat - currentPos.lat;
        const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

        if (distanceToTarget < 0.00006) {
          waypointIndex++;
          currentActualPath = [...currentActualPath, [targetPos.lat, targetPos.lon]];
          setActualPath(currentActualPath);
          
          if (waypointIndex >= predictedPath.length) {
            clearInterval(flightIntervalRef.current);
          }
          
          return { ...prevData, currentLat: targetPos.lat, currentLon: targetPos.lon };
        }

        const stepSize = 0.00005;
        const newLat = currentPos.lat + (dy / distanceToTarget) * stepSize;
        const newLon = currentPos.lon + (dx / distanceToTarget) * stepSize;
        
        currentActualPath = [...currentActualPath, [newLat, newLon]];
        setActualPath(currentActualPath);
        
        const bearing = getBearing(currentPos.lat, currentPos.lon, newLat, newLon);

        return {
          ...prevData,
          battery: Math.max(0, prevData.battery - 0.05),
          currentLat: newLat, currentLon: newLon,
          heading: toCardinal(bearing),
        };
      });
    }, 500);

    return () => {
      clearInterval(flightIntervalRef.current);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startPoint, predictedPath]);

  useEffect(() => {
    if (isVideoExpanded && videoRef.current && videoRef.current.srcObject) {
      if (modalVideoRef.current) {
         modalVideoRef.current.srcObject = videoRef.current.srcObject;
      }
    }
  }, [isVideoExpanded]);


  // --- Event Handlers ---
  const handleGenerateJson = () => {
    setJsonData(JSON.stringify({
      timestamp: new Date().toISOString(),
      position: { latitude: droneData.currentLat.toFixed(6), longitude: droneData.currentLon.toFixed(6), altitude_meters: droneData.altitude },
      telemetry: { battery_percent: Math.round(droneData.battery), signal_strength_percent: droneData.signal, speed_kmh: droneData.speed, heading: droneData.heading },
      video_feed: { status: droneData.videoStatus, detected_object: droneData.objectDetected },
      flight_plan: { waypoints: predictedPath, total_distance_km: (pathData.totalDistance / 1000).toFixed(2) }
    }, null, 2));
  };

  const handleCopyJson = () => {
    if (jsonData) {
      navigator.clipboard.writeText(jsonData);
      setCopyStatusText('Copied!');
      setTimeout(() => setCopyStatusText('Copy'), 2000);
    }
  };
  const currentPosition = [droneData.currentLat, droneData.currentLon];

  return (
    <div className="h-screen w-screen bg-gray-100 text-gray-800 font-sans flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white shadow-md p-3 flex justify-between items-center flex-shrink-0 z-20">
        <h1 className="text-xl font-bold text-green-800">QUATUM DRONE CONTROL</h1>
        <div className="flex items-center gap-6">
          <div className="indicator">Battery: <BatteryIcon level={Math.round(droneData.battery)} /></div>
          <div className="indicator">Signal: <SignalIcon strength={droneData.signal} /></div>
        </div>
        <div className="flex gap-2">
          <button className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">RETURN HOME</button>
          <button className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">LAND NOW</button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-grow p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-hidden">
        {/* Map Panel */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-lg overflow-hidden">
            <MapContainer center={startPoint} zoom={16} scrollWheelZoom={true} className="h-full w-full z-0">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                <MapController />
                
                {/* Paths */}
                <Polyline pathOptions={{ color: 'gray', weight: 4, opacity: 0.8, dashArray: '5, 10' }} positions={predictedPath} />
                <Polyline pathOptions={{ color: 'cyan', weight: 4 }} positions={actualPath} />
                
                {/* Waypoints and Distance Labels */}
                {predictedPath.map((pos, index) => (
                    <Marker key={`wp-${index}`} position={pos} icon={createWaypointIcon(index + 1)} />
                ))}
                {pathData.segments.map((seg, index) => (
                    <Marker key={`dist-${index}`} position={seg.midpoint} icon={new L.divIcon({
                        className: 'distance-label',
                        html: `<div class="bg-black bg-opacity-60 text-white px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap">${seg.distance.toFixed(1)}M</div>`
                    })} />
                ))}

                <Marker position={currentPosition} icon={droneIcon} />
                
                {/* Data Overlay */}
                 <div className="leaflet-top leaflet-right">
                    <div className="leaflet-control bg-white bg-opacity-80 p-2 rounded-md shadow-lg m-2 text-sm">
                        <h3 className="font-bold text-center mb-1">Flight Plan</h3>
                        <p><strong>Waypoints:</strong> {predictedPath.length}</p>
                        <p><strong>Total Distance:</strong> {(pathData.totalDistance / 1000).toFixed(2)} km</p>
                        <hr className="my-1 border-gray-400"/>
                        <h3 className="font-bold text-center mb-1">Live Data</h3>
                        <p><strong>Speed:</strong> {droneData.speed} km/h</p>
                        <p><strong>Heading:</strong> {droneData.heading}</p>
                    </div>
                </div>
              </MapContainer>
        </div>

        {/* Side Panels */}
        <div className="flex flex-col gap-4 overflow-y-auto">
            {/* Live Feed Panel */}
            <div className="panel bg-black rounded-lg shadow-lg flex flex-col text-white overflow-hidden relative">
                <div className="panel-content flex-grow flex items-center justify-center">
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain"></video>
                    
                    {/* Floating Status Indicator */}
                    <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                        {droneData.isLive && (
                            <>
                                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                <span className="font-bold text-white" style={{textShadow: '1px 1px 3px #000'}}>Connected</span>
                            </>
                        )}
                    </div>

                    {/* Hover Overlay for expanding */}
                    <div className="absolute inset-0 bg-black opacity-0 hover:opacity-60 transition-opacity flex items-center justify-center cursor-pointer" onClick={() => setIsVideoExpanded(true)}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m7-5h4m0 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m7 5h4m0 0v4m0-4l-5 5" /></svg>
                    </div>

                    <div className="absolute bottom-2 left-2 text-xs font-mono bg-black bg-opacity-50 p-1 rounded">
                        <p>GPS: {droneData.currentLat.toFixed(4)}, {droneData.currentLon.toFixed(4)}</p>
                        <p>Detection: {droneData.objectDetected}</p>
                    </div>
                </div>
            </div>

            {/* JSON Panel */}
            <div className="panel bg-white rounded-lg shadow-lg flex flex-col flex-shrink-0">
                <div className="panel-header p-3 flex justify-between items-center border-b border-gray-200">
                    <h2 className="text-lg font-bold">Live Data to JSON</h2>
                    <button onClick={handleCopyJson} className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-1 px-3 rounded-lg transition-colors text-sm">
                        {copyStatusText === 'Copy' ? <CopyIcon /> : <CheckIcon />}
                        {copyStatusText}
                    </button>
                </div>
                <div className="panel-content p-3">
                    <button onClick={handleGenerateJson} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg w-full mb-3 transition-colors">
                        Generate JSON Snapshot
                    </button>
                    <pre className="bg-gray-100 rounded-md p-2 text-xs overflow-x-auto h-48">{jsonData || 'Click the button to generate JSON...'}</pre>
                </div>
            </div>
        </div>
      </main>

      {/* Video Modal Overlay */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 transition-opacity duration-300 ${isVideoExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsVideoExpanded(false)}>
          <div className="relative w-11/12 h-5/6" onClick={e => e.stopPropagation()}>
            <video ref={modalVideoRef} autoPlay muted playsInline className="w-full h-full object-contain"></video>
            <button onClick={() => setIsVideoExpanded(false)} className="absolute top-4 right-4 text-white text-4xl hover:text-gray-300">&times;</button>
          </div>
      </div>
    </div>
  );
}

