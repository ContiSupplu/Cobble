import React, { useState, useEffect } from 'react';
import { useProxiedImage } from '../hooks/useProxiedImage';
import './PlayerLookupPage.css';

const api = (window as any).electronAPI;

interface PlayerResult {
  name: string;
  id: string;
}

// Sub-component: resolves face from Mojang directly
function PlayerSkinHead({ id, name }: { id: string; name: string }) {
  const [skinUrl, setSkinUrl] = useState<string | null>(null)
  const fallback = useProxiedImage(`https://mc-heads.net/avatar/${id}/64`)

  useEffect(() => {
    if (!api?.resolveSkinUrl) return
    api.resolveSkinUrl(id, 64).then((url: string | null) => {
      if (url) setSkinUrl(url)
    })
  }, [id])

  const src = skinUrl || fallback
  if (!src) return <div className="player-card-head player-card-head-placeholder" />
  return <img className="player-card-head" src={src} alt={`${name} head`} />
}

function PlayerSkinBody({ id, name }: { id: string; name: string }) {
  const [bodyUrl, setBodyUrl] = useState<string | null>(null)
  const fallback = useProxiedImage(`https://mc-heads.net/body/${id}`)

  useEffect(() => {
    if (!api?.resolveBodyUrl) return
    api.resolveBodyUrl(id, 256).then((url: string | null) => {
      if (url) setBodyUrl(url)
    })
  }, [id])

  const src = bodyUrl || fallback
  if (!src) return <div className="player-card-body player-card-body-placeholder" />
  return <img className="player-card-body" src={src} alt={`${name} skin`} />
}

const PlayerLookupPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [player, setPlayer] = useState<PlayerResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [friended, setFriended] = useState(false);

  const handleSearch = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;

    setLoading(true);
    setPlayer(null);
    setSearched(false);
    setFriended(false);

    try {
      const result = await window.electronAPI?.lookupPlayer(trimmed);
      setPlayer(result ?? null);
    } catch {
      setPlayer(null);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="player-lookup-page page-enter">
      <h1 className="player-lookup-title">Players</h1>

      <div className="player-lookup-center">
        <input
          className="player-lookup-input"
          type="text"
          placeholder="Search by username..."
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {!searched && !loading && (
          <p className="player-lookup-hint">Look up any player to view their skin and stats</p>
        )}

        {loading && <p className="player-lookup-hint">Searching...</p>}

        {searched && !loading && !player && (
          <p className="player-lookup-hint">Player not found</p>
        )}

        {player && !loading && (
          <div className="player-card">
            <div className="player-card-header">
              <PlayerSkinHead id={player.id} name={player.name} />
              <div className="player-card-identity">
                <span className="player-card-name">{player.name}</span>
                <span className="player-card-uuid">{player.id}</span>
              </div>
            </div>
            <PlayerSkinBody id={player.id} name={player.name} />
            <button
              className={`player-card-friend ${friended ? 'player-card-friend--added' : ''}`}
              onClick={() => setFriended((prev) => !prev)}
            >
              {friended ? 'Added' : 'Friend'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerLookupPage;
