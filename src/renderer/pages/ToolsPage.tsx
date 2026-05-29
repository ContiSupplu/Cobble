import React, { useState } from 'react';
import './ToolsPage.css';

const tools = [
  { name: 'Auto Clicker', description: 'Automates left or right click at a configurable interval' },
  { name: 'Bridge Assist', description: 'Assists with block placement while bridging' },
  { name: 'CPS Counter', description: 'Displays clicks per second in an overlay' },
];

const ToolsPage: React.FC = () => {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const toggle = (name: string) => {
    setEnabled((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div className="tools-page page-enter">
      <h1 className="tools-title">Tools</h1>

      <div className="tools-warning">
        For use on private servers only. Using these tools on public servers may result in bans.
      </div>

      <div className="tools-list">
        {tools.map((tool) => (
          <div className="tool-item" key={tool.name}>
            <div className="tool-info">
              <span className="tool-name">{tool.name}</span>
              <span className="tool-desc">{tool.description}</span>
            </div>
            <div
              className={`tool-toggle ${enabled[tool.name] ? 'on' : ''}`}
              onClick={() => toggle(tool.name)}
            >
              <div className="tool-toggle-dot" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ToolsPage;
