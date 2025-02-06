import React, {useState, useRef} from "react";
import { Canvas } from "@react-three/fiber";
import TerrainBuilder, { blockTypes} from "./js/TerrainBuilder";
import EnvironmentBuilder from "./js/EnvironmentBuilder";
import {
  FaCamera,
  FaVolumeMute,
  FaDatabase,
} from "react-icons/fa";
import Tooltip from "./js/components/Tooltip";
import hytopiaLogo from "./images/Hytopia_Tiny.png";
import "./css/App.css";
import {toggleMute, isMuted} from "./js/Sound";
import DebugInfo from './js/components/DebugInfo';
import BlockToolsSidebar from './js/components/BlockToolsSidebar';
import { version } from './js/Constants';
import ToolBar from './js/components/ToolBar';
import {DatabaseManager} from './js/DatabaseManager';

function App() {
  const [terrain, setTerrainState] = useState({});
  const [currentBlockType, setCurrentBlockType] = useState(blockTypes[0]);
  const [mode, setMode] = useState("add");
  const [debugInfo, setDebugInfo] = useState({ mouse: {}, preview: {}, grid: {}});
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [axisLockEnabled, setAxisLockEnabled] = useState(false);
  const [cameraReset, setCameraReset] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(0);
  const [placementSize, setPlacementSize] = useState("single");
  const [activeTab, setActiveTab] = useState("blocks");
  const [pageIsLoaded, setPageIsLoaded] = useState(false);
  const [currentDraggingBlock, setCurrentDraggingBlock] = useState(null);
  const handleDropRef = useRef(null);
  const [customBlocks, setCustomBlocks] = useState([]);
  const [scene, setScene] = useState(null);
  const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
  const [gridSize, setGridSize] = useState(100);
  const environmentBuilderRef = useRef(null);

  const LoadingScreen = () => (
    <div className="loading-screen">
      <img src={hytopiaLogo} alt="Hytopia Logo" className="loading-logo" />
      <div className="loading-spinner"></div>
      <div className="loading-text">
        <i>Loading...</i>
      </div>
      <div className="version-text">HYTOPIA Map Builder v{version}</div>
    </div>
  );

  return (
    <div className="App">
      {/* Loading Screen */}
      {!pageIsLoaded && <LoadingScreen />}

      {/* Hytopia Logo */}
      <div className="hytopia-logo">
        <img src={hytopiaLogo} alt="Hytopia Logo" className="hytopia-logo" />
        <p style={{ marginTop: '50px', fontSize: '12px', color: 'gray'}}>World Editor Version {version}</p>
      </div>

      <BlockToolsSidebar
        activeTab={activeTab}
        blockTypes={blockTypes}
        currentBlockType={currentBlockType}
        customBlocks={customBlocks}
        setCustomBlocks={setCustomBlocks}
        setCurrentBlockType={setCurrentBlockType}
        updateTerrainWithHistory={setTerrainState}
        setActiveTab={setActiveTab}
      />

      <Canvas shadows className="canvas-container">
        <TerrainBuilder
          setAppJSTerrainState={setTerrainState}
          currentBlockType={currentBlockType}
          mode={mode}
          setDebugInfo={setDebugInfo}
          sendTotalBlocks={setTotalBlocks}
          axisLockEnabled={axisLockEnabled}
          placementSize={placementSize}
          cameraReset={cameraReset}
          cameraAngle={cameraAngle}
          onCameraAngleChange={setCameraAngle}
          setPageIsLoaded={setPageIsLoaded}
          currentDraggingBlock={currentDraggingBlock}
          onHandleDropRef={(fn) => (handleDropRef.current = fn)}
          customBlocks={customBlocks}
          onSceneReady={(sceneObject) => setScene(sceneObject)}
          totalEnvironmentObjects={totalEnvironmentObjects}
          gridSize={gridSize}
          environmentBuilderRef={environmentBuilderRef}
        />
        {scene && (
          <EnvironmentBuilder
            ref={environmentBuilderRef}
            scene={scene}
            currentBlockType={currentBlockType}
            mode={mode}
            onTotalObjectsChange={setTotalEnvironmentObjects}
            placementSize={placementSize}
          />
        )}
      </Canvas>

      <DebugInfo 
        debugInfo={debugInfo}
        totalBlocks={totalBlocks}
        totalEnvironmentObjects={totalEnvironmentObjects} 
      />

      <ToolBar
        mode={mode}
        handleModeChange={setMode}
        axisLockEnabled={axisLockEnabled}
        setAxisLockEnabled={setAxisLockEnabled}
        placementSize={placementSize}
        setPlacementSize={setPlacementSize}
        terrain={terrain}
        currentBlockType={currentBlockType}
        setTerrainState={setTerrainState}
        setGridSize={setGridSize}
      />

      <div className="camera-controls-wrapper">
        <Tooltip text="Reset camera position">
          <button onClick={() => setCameraReset((prev) => !prev)} className="camera-control-button">
            <FaCamera />
          </button>
        </Tooltip>
        <Tooltip text={isMuted ? "Unmute" : "Mute"}>
          <button
            onClick={toggleMute}
            className={`camera-control-button ${!isMuted ? "active" : ""}`}
          >
            <FaVolumeMute />
          </button>
        </Tooltip>

        <div className="camera-angle-slider">
          <input
            type="range"
            min="-80"
            max="10"
            value={cameraAngle}
            className="vertical-slider"
            onChange={(e) => setCameraAngle(parseFloat(e.target.value))}
          />
        </div>
      </div>

      <div className="controls-description">
        W, A, S, D & Middle Mouse - Move Camera | Right Mouse - Rotate Camera |
        Space - Move Up | Shift - Move Down
      </div>
      <div
        className="controls-description"
        style={{ marginTop: "20px", color: "green" }}
      >
        New Functionality: Drag and drop a block from the toolbar onto other
        blocks to replace them.
      </div>
      <button
        className="toolbar-button"
        onClick={async () => await DatabaseManager.clearDatabase()}
        title="Clear Database"
        style={{ position: "absolute", bottom: "10px", left: "10px" }}
      >
        <FaDatabase />
      </button>
    </div>
  );
}

export default App;
