export const AllStarUI = {
    categories: [
        { id: 'EFF', label: 'Efficiency', position: 'top-center' },
        { id: 'VEL', label: 'Velocity', position: 'mid-left' },
        { id: 'OPS', label: 'Operations', position: 'mid-right' },
        { id: 'REV', label: 'Financials', position: 'bottom-left' },
        { id: 'HLT', label: 'Health', position: 'bottom-right' }
    ],

    

    getBestDispatchers: function() {
        if (!this.mainUI || !this.mainUI.state.stats) return {};

        const candidates = {};
        
        this.categories.forEach(cat => {
            const list = [];
            this.mainUI.state.dispatchers.forEach(d => {
                const stats = this.mainUI.state.stats[d.name.trim().toLowerCase()];
                if (!stats || !stats.scores) return;
                
                const score = parseFloat(stats.scores[cat.id]) || 0;
                if (score <= 0) return;

                list.push({ 
                    ...d, 
                    metricScore: score, 
                    catLabel: cat.label,
                    overallScore: stats.overallScore,
                    allScores: stats.scores
                });
            });
            list.sort((a, b) => b.metricScore - a.metricScore || b.rating - a.rating);
            candidates[cat.id] = list;
        });

        const currentIndices = {};
        this.categories.forEach(c => currentIndices[c.id] = 0);

        let currentAssignments = {};
        
        const getCandidate = (catId) => {
            const list = candidates[catId];
            const idx = currentIndices[catId];
            if (!list || idx >= list.length) return null;
            return list[idx];
        };

        this.categories.forEach(cat => {
            const d = getCandidate(cat.id);
            if (d) currentAssignments[cat.id] = d;
        });

        let settled = false;
        let safetyCounter = 0;

        while (!settled && safetyCounter < 50) {
            settled = true;
            safetyCounter++;

            const dispToCats = {};
            Object.keys(currentAssignments).forEach(catId => {
                const d = currentAssignments[catId];
                if (!dispToCats[d.id]) dispToCats[d.id] = [];
                dispToCats[d.id].push(catId);
            });

            const conflictIds = Object.keys(dispToCats).filter(id => dispToCats[id].length > 1);

            if (conflictIds.length > 0) {
                settled = false; 
                
                const dId = conflictIds[0];
                const wonCats = dispToCats[dId];

                let bestCatToKeep = null;
                let maxLead = -Infinity;

                wonCats.forEach(catId => {
                    const currentWinner = getCandidate(catId); 
                    
                    const nextIdx = currentIndices[catId] + 1;
                    const nextCandidate = candidates[catId] && candidates[catId][nextIdx];

                    const lead = nextCandidate ? (currentWinner.metricScore - nextCandidate.metricScore) : 9999;

                    if (lead > maxLead) {
                        maxLead = lead;
                        bestCatToKeep = catId;
                    }
                });

                wonCats.forEach(catId => {
                    if (catId !== bestCatToKeep) {
                        currentIndices[catId]++; 
                        
                        const nextBest = getCandidate(catId);
                        if (nextBest) {
                            currentAssignments[catId] = nextBest;
                        } else {
                            delete currentAssignments[catId];
                        }
                    }
                });
            }
        }

        return currentAssignments;
    },

   renderTriggerBtn: function(context) {
        this.mainUI = context;
        const container = document.querySelector('.dota-view');
        if (!container) return;

        if (document.getElementById('all-star-trigger')) return;

        const btn = document.createElement('div');
        btn.id = 'all-star-trigger';
        btn.className = 'all-star-trigger';
        btn.innerHTML = `
            <div class="star-icon">★</div>
            <div class="star-label">ALL STAR</div>
        `;
        
        btn.onclick = () => this.openModal();
        container.appendChild(btn);
    },

   openModal: function() {
        const bestData = this.getBestDispatchers();

        let globalMVP = null;
        let maxRating = -1;
        this.mainUI.state.dispatchers.forEach(d => {
            if (d.rating > maxRating) {
                maxRating = d.rating;
                globalMVP = d;
            }
        });

        let mvpInWinners = false;
        let mvdKey = null; 

        if (globalMVP) {
            Object.keys(bestData).forEach(key => {
                if (bestData[key].id === globalMVP.id) {
                    mvpInWinners = true;
                    mvdKey = key;
                }
            });
        }

        let posMap = {
            'EFF': 'pos-top-center',
            'VEL': 'pos-mid-left',
            'OPS': 'pos-mid-right',
            'REV': 'pos-bot-left',
            'HLT': 'pos-bot-right'
        };

        if (mvpInWinners && mvdKey && posMap[mvdKey] !== 'pos-top-center') {
            const currentTopKey = Object.keys(posMap).find(k => posMap[k] === 'pos-top-center');
            const oldMvdPos = posMap[mvdKey];
            posMap[mvdKey] = 'pos-top-center';     
            posMap[currentTopKey] = oldMvdPos;     
        }

        let cardsHtml = '';
        let delayCounter = 1;

        Object.keys(bestData).forEach(key => {
            const positionClass = posMap[key];
            const isMVP = (mvpInWinners && key === mvdKey);

            if (isMVP) {
                const mvdD = bestData[key];
                cardsHtml += `
                    <div class="star-card-wrapper mvp-anim-final-pos">
                        <div class="mvd-burst-bg"></div>
                        <div class="mvp-floating-tag" style="top: -15px !important;">👑 MVP</div>
                        ${this.renderCardHTML(mvdD, mvdD.catLabel, true, key)}
                    </div>
                `;
            } else {
                cardsHtml += this.renderCard(bestData[key], `${positionClass} delay-${delayCounter}`, bestData[key].catLabel, false, key);
                delayCounter++;
            }
        });

        if (!mvpInWinners && globalMVP) {
            const s = this.mainUI.state.stats[globalMVP.name.trim().toLowerCase()];
            const mvpData = {
                ...globalMVP,
                overallScore: s ? s.overallScore : 0,
                allScores: s ? s.scores : {},
                catLabel: 'MVP'
            };

            cardsHtml += `
                <div class="star-card-wrapper mvp-anim-top-right">
                    <div class="mvd-burst-bg"></div>
                    <div class="mvp-floating-tag" style="top: -15px !important;">👑 MVP</div>
                    ${this.renderCardHTML(mvpData, 'MVP', true, 'NONE')}
                </div>
            `;
        }

        const modal = document.createElement('div');
        modal.className = 'all-star-modal-overlay';
        
        const linesSvg = `
            <svg class="constellation-lines-layer" width="100%" height="100%" style="pointer-events: none;">
                <defs>
                    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#14b8a6;stop-opacity:0" />
                        <stop offset="50%" style="stop-color:#14b8a6;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#14b8a6;stop-opacity:0" />
                    </linearGradient>
                </defs>
                <line x1="50%" y1="20%" x2="28%" y2="42%" class="constellation-line line-app-green" style="animation-delay: 0.7s" />
                <line x1="50%" y1="20%" x2="72%" y2="42%" class="constellation-line line-app-green" style="animation-delay: 0.7s" />
                <line x1="28%" y1="42%" x2="42%" y2="65%" class="constellation-line line-app-green" style="animation-delay: 0.8s" />
                <line x1="72%" y1="42%" x2="58%" y2="65%" class="constellation-line line-app-green" style="animation-delay: 0.8s" />
                <line x1="42%" y1="65%" x2="58%" y2="65%" class="constellation-line line-app-green" style="animation-delay: 0.9s" />
            </svg>
        `;

        modal.innerHTML = `
            <div id="all-star-particles" style="pointer-events: none;"></div>
            ${linesSvg}
            <button class="close-star-modal" style="z-index: 10001;">✕</button>
            <div class="star-constellation">
                ${cardsHtml}
                <div class="as-footer-title">
                    <span class="as-star-icon">★</span> DISPATCHER ALL STAR
                    <div class="as-tooltip-wrapper" style="margin-left: 20px; pointer-events: auto; position: relative; display: flex; align-items: center;">
                        <svg class="as-info-svg" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                        </svg>
                        <div class="as-tooltip-popup">
                            <p><strong style="color:#14b8a6; text-transform:uppercase;">The All-Star Team</strong></p>
                            <p>This lineup features the top-performing dispatcher from each of the 5 key categories (Efficiency, Velocity, Operations, Financials, Health).</p>
                            <p style="color:#9ca3af;"><span style="color:#fbbf24; font-weight:bold;">👑 MVP:</span> The dispatcher with the highest Overall Score across all companies.</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <style>
                .pos-top-center { top: 22% !important; }
                .pos-top-right  { top: 12%; left: 88%; z-index: 60; }
                
                .info-tooltip-icon:hover { 
                    color: #fff; 
                    border-color: #fff; 
                    background: rgba(255,255,255,0.2) !important; 
                }
                
                .as-footer-title {
                    position: absolute;
                    bottom: 2%;
                    width: 100%;
                    text-align: center;
                    font-size: 60px;
                    font-weight: 900;
                    font-style: italic;
                    color: rgba(255, 255, 255, 0.05);
                    -webkit-text-stroke: 2px #fff;
                    text-transform: uppercase;
                    letter-spacing: -3px;
                    font-family: 'Impact', 'Arial Black', sans-serif;
                    text-shadow: 0 0 30px rgba(255, 215, 0, 0.3);
                    z-index: 50;
                    opacity: 0;
                    transform: skewX(-15deg);
                    animation: fadeInTitle 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) 4.5s forwards;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 15px;
                    pointer-events: none;
                }
                    .as-footer-title {
                    word-spacing: 15px; 
                }

                .as-info-svg {
                    width: 24px; height: 24px;
                    color: #9ca3af;
                    cursor: help;
                    transition: 0.2s;
                }
                .as-info-svg:hover {
                    color: #fff;
                }

                .as-tooltip-popup {
                    visibility: hidden;
                    opacity: 0;
                    position: absolute;
                    bottom: 100%; 
                    left: 50%;
                    transform: translateX(-50%) translateY(5px);
                    width: 320px;
                    background: #1f2937;
                    border: 1px solid #4b5563;
                    padding: 12px;
                    border-radius: 6px;
                    box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.7);
                    z-index: 10002;
                    
                    text-transform: none;
                    text-align: left;
                    text-shadow: none;
                    -webkit-text-stroke: 0px;
                    letter-spacing: normal;
                    word-spacing: normal;
                    
                    pointer-events: none;
                    margin-bottom: 10px;
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                }

                .as-tooltip-popup p { 
                    margin: 0 0 8px 0; 
                    color: #e5e7eb; 
                    font-size: 12px; 
                    line-height: 1.4; 
                    font-weight: 500; 
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }

                .as-tooltip-popup p:last-child {
                    margin: 0;
                }

                .as-tooltip-popup::after {
                    content: "";
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    margin-left: -5px;
                    border-width: 5px;
                    border-style: solid;
                    border-color: #1f2937 transparent transparent transparent;
                }
                
                .as-tooltip-wrapper:hover .as-tooltip-popup {
                    visibility: visible;
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }

                .as-star-icon {
                    color: #ffd700;
                    font-size: 50px;
                    filter: drop-shadow(0 0 25px rgba(255, 215, 0, 1));
                    animation: starPulse 1.5s infinite alternate;
                    -webkit-text-stroke: 0px;
                }

                .custom-tooltip-text {
                    visibility: hidden;
                    width: 240px;
                    background-color: #1f2937;
                    color: #d1d5db;
                    text-align: center;
                    border-radius: 6px;
                    padding: 10px;
                    position: absolute;
                    z-index: 10002;
                    bottom: 150%;
                    left: 50%;
                    transform: translateX(-50%);
                    opacity: 0;
                    transition: opacity 0.3s;
                    border: 1px solid #374151;
                    font-size: 11px;
                    line-height: 1.4;
                    font-weight: normal;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
                    white-space: normal;
                }

                .custom-tooltip-text::after {
                    content: "";
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    margin-left: -5px;
                    border-width: 5px;
                    border-style: solid;
                    border-color: #374151 transparent transparent transparent;
                }

                .info-tooltip-wrapper:hover .custom-tooltip-text {
                    visibility: visible;
                    opacity: 1;
                }

                @keyframes mvpMoveToTopSequence {
                    0% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(0); 
                        opacity: 0; 
                    }
                    20% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(1.6);
                        opacity: 1;
                    }
                    70% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(1.6);
                        opacity: 1;
                    }
                    100% { 
                        top: 22%; left: 50%; 
                        transform: translate(-50%, -50%) scale(1); 
                        opacity: 1; 
                    }
                }

                .mvp-anim-top-right {
                    position: absolute;
                    top: 20%; left: 85%; 
                    transform: translate(-50%, -50%);
                    z-index: 10000;
                    width: 170px; height: 255px; 
                    perspective: 1000px;
                    opacity: 0; 
                    animation: mvpMoveToRight 5s cubic-bezier(0.19, 1, 0.22, 1) 0.5s forwards;
                }

                @keyframes mvpMoveToRight {
                    0% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(0); 
                        opacity: 0; 
                    }
                    20% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(1.6);
                        opacity: 1;
                    }
                    70% { 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%) scale(1.6);
                        opacity: 1;
                    }
                    100% { 
                        top: 12%; left: 88%; 
                        transform: translate(-50%, -50%) scale(1); 
                        opacity: 1; 
                    }
                }
                
                .mvp-floating-tag {
                    font-size: 14px !important;
                    padding: 4px 12px !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 6px !important;
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 200;
                    width: auto !important;
                    white-space: nowrap;
                }
            </style>
        `;

        document.body.appendChild(modal);

        if (window.particlesJS) {
            window.particlesJS('all-star-particles', {
              "particles": {
                "number": { "value": 60 },
                "color": { "value": "#14b8a6" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.3, "random": true },
                "size": { "value": 3, "random": true },
                "line_linked": { "enable": true, "distance": 150, "color": "#14b8a6", "opacity": 0.2, "width": 1 },
                "move": { "enable": true, "speed": 4 }
              },
              "interactivity": { "events": { "onhover": { "enable": true, "mode": "repulse" } } }
            });
        }

        requestAnimationFrame(() => modal.classList.add('active'));

        modal.querySelector('.close-star-modal').onclick = () => {
            modal.classList.remove('active');
            setTimeout(() => modal.remove(), 300);
        };
    },
    // Wrapper for animation classes
    renderCard: function(data, positionClass, label, isMVD, winningCatId) {
        if (!data) return '';
        const extraStyle = positionClass.includes('pos-top-center') ? 'top: 22% !important;' : '';
        return `
            <div class="star-card-wrapper ${positionClass} card-anim-entry" style="${extraStyle}">
                ${this.renderCardHTML(data, label, isMVD, winningCatId)}
            </div>
        `;
    },

    // Core Card HTML
    renderCardHTML: function(data, label, isMVD, winningCatId) {
        const glowClass = isMVD ? 'card-mvd' : '';
        const teamLogo = data.teamLogo || 'https://via.placeholder.com/50';
        const displayScore = data.overallScore || 0; 

        const scores = data.allScores || {};
        const cats = ['EFF', 'VEL', 'OPS', 'REV', 'HLT'];
        
        const scoresHtml = cats.map(c => {
            const isWinner = c === winningCatId;
            const color = isWinner ? '#4ade80' : '#fff';
            const fontSize = isWinner ? '19px' : '14px'; 
            const labelColor = isWinner ? '#4ade80' : '#6b7280';
            
            return `
            <div style="display:flex; flex-direction:column; align-items:center; gap:0px;">
                <span style="font-size:10px; font-weight:700; color:${labelColor}; line-height:1.1;">${c}</span>
                <span style="font-size:${fontSize}; font-weight:800; color:${color}; transition: all 0.3s; line-height:1.1;">${scores[c]||0}</span>
            </div>
            `;
        }).join('');

        const labelStyle = isMVD ? 'color: #14b8a6 !important;' : '';

        return `
            <div class="star-card ${glowClass}" onclick="AllStarUI.mainUI.openDispatcherModal('${data.id}')" style="transform: scale(1.0); transform-origin: center center;">
                 <div class="star-top-row" style="height: 15%;">
                     <img src="${teamLogo}" class="star-corner-logo">
                     <div class="star-corner-rating" title="Overall Rating">${displayScore}</div>
                 </div>
                
                <div class="star-card-img-box" style="margin-bottom:0px; height: 70%;">
                    <img src="${data.photo}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMjAgMzAwIj><cmVjdCB3aWR0aD0iMjIwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzMzNDE1NSIvPjwvc3ZnPg=='">
                </div>

                <div style="display:flex; align-items:flex-end; justify-content:space-between; width:100%; padding:0 8px 0px 8px; margin-top: 5px; height: auto; z-index: 10; position: relative;">
                    ${scoresHtml}
                </div>

                <div class="star-card-info" style="padding-top: 2px; padding-bottom: 3px; justify-content: center; height: 15% !important;">
                    <div class="star-name" style="margin-bottom: 1px; line-height: 1.1;">${data.name}</div>
                    <div class="star-category" style="margin-top: 0px; line-height: 1; ${labelStyle}">${label}</div>
                </div>
            </div>
        `;
    },
    
    getTeamIcon: function(team) { return ''; } // Deprecated used in old version
};
window.AllStarUI = AllStarUI;