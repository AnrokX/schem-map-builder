import React from 'react';
import '../../css/DebugInfo.css';

const DebugInfo = ({ debugInfo, totalEnvironmentObjects }) => {
  return (
    <div className="debug-info">
      <div className="debug-row">
        <span className="debug-label">Preview Position:</span>
        <span className="debug-value">
          x: <b>{(debugInfo?.preview?.x || 0).toFixed(1)}</b><br></br>
          y: <b>{(debugInfo?.preview?.y || 0).toFixed(1)}</b><br></br>
          z: <b>{(debugInfo?.preview?.z || 0).toFixed(1)}</b>
        </span> 
      </div>
      <div className="single-line"></div>
      <div className="debug-row">
        <span className="debug-label">Total Blocks:</span>
        <span className="debug-value">
          <b>{debugInfo?.totalBlocks || 0}</b>
        </span>
      </div>
      <div className="single-line"></div>
      <div className="debug-row">
        <span className="debug-label">Total Env. Objects:</span>
        <span className="debug-value">
          <b>{totalEnvironmentObjects}</b>
        </span>
      </div>
    </div>
  );
};

export default DebugInfo;
