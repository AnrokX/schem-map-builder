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
                <p className="tip-text">Drag + Drop a block this is a test of very long text that should be wrapped at some point, so we'll see how it gets wrapped</p>
                <div className="tip-close-button" onClick={toggleVisibility}>
                    <FaTimes />
                </div>
            </div>
        </div>
    )
  );
};

export default QuickTips;
