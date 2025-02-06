import React from 'react';

const DebugInfo = ({ debugInfo, totalEnvironmentObjects }) => {
  return (
    <div className="debug-info">
      <p>
        Preview: x:{debugInfo?.preview?.x || 0}, y:{debugInfo?.preview?.y || 0}, z:{debugInfo?.preview?.z || 0}
      </p>
      <p>Total Blocks: {debugInfo?.totalBlocks || 0}</p>
      <p>Total Env. Objects: {totalEnvironmentObjects}</p>
    </div>
  );
};

export default DebugInfo;
