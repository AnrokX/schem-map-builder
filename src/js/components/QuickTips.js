import { useState } from 'react';
import '../../css/QuickTips.css';
import { FaTimes } from 'react-icons/fa';


const QuickTips = () => {

    const [isVisible, setIsVisible] = useState(true);

    const toggleVisibility = () => {
        setIsVisible(!isVisible);
    }

  return (
    isVisible && (
        <div className="quick-tips-container">
            <div className="quick-tips">
                <p className="tip-title">Quick Tips:</p>
                <p className="tip-text">Move the camera with W, A, S, D. Right click to rotate. Middle click to drag-move.</p>
                <div className="tip-close-button" onClick={toggleVisibility}>
                    <FaTimes />
                </div>
            </div>
        </div>
    )
  );
};

export default QuickTips;
