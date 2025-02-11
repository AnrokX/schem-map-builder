import React, { useState, useEffect, useRef } from 'react';

const Tooltip = ({ children, text }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0, isRightSide: false });
  const [tooltipWidth, setTooltipWidth] = useState(0);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (isVisible && tooltipRef.current) {
      setTooltipWidth(tooltipRef.current.offsetWidth);
    }
  }, [isVisible]);

  /// sets initial position when mouse enters the component
  const handleMouseEnter = (e) => {
    const screenWidth = window.innerWidth;
    const isRightSide = e.clientX > screenWidth / 2;
    setMousePosition({ 
      x: e.clientX, 
      y: e.clientY,
      isRightSide 
    });
    setIsVisible(true);
  };

  const handleMouseLeave = (e) => {
    setIsVisible(false);
  };

  const handleMouseMove = (e) => {
    if (!isVisible) return;
    const screenWidth = window.innerWidth;
    const isRightSide = e.clientX > screenWidth / 2;
    setMousePosition({ 
      x: e.clientX, 
      y: e.clientY,
      isRightSide 
    });
  };

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} onMouseMove={handleMouseMove}>
      {children}
      {isVisible && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: `${mousePosition.y - 30}px`,
            left: mousePosition.isRightSide 
              ? `${mousePosition.x - 20 - tooltipWidth}px`
              : `${mousePosition.x + 20}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '5px 10px',
            borderRadius: '4px',
            fontSize: '14px',
            zIndex: 1000,
            pointerEvents: 'none',
            opacity: tooltipWidth ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
