// dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素引用
    const searchInput = document.getElementById('search-input');
    const marketFilter = document.getElementById('market-filter');
    const warningTbody = document.getElementById('warning-tbody');
    const disposedTbody = document.getElementById('disposed-tbody');
    const countNotice = document.getElementById('count-notice');
    const countWarn = document.getElementById('count-warn');
    const countDisposed = document.getElementById('count-disposed');
    const detailPlaceholder = document.getElementById('detail-placeholder');
    const detailCard = document.getElementById('detail-card');
    const detailSection = document.getElementById('detail-section');
    const statusText = document.getElementById('status-text');

    // 全局資料狀態
    let allStocks = [];
    let filteredWarningStocks = [];
    let filteredDisposedStocks = [];
    let selectedStockCode = null;

    // 日期解析輔助函式 (民國日期 -> JavaScript Date)
    function parseRocDateToDate(dateStr) {
        if (!dateStr) return null;
        let m = dateStr.match(/^(\d{2,3})[/\.\-](\d{2})[/\.\-](\d{2})$/);
        if (m) {
            let yr = parseInt(m[1], 10);
            if (yr < 100) yr += 100;
            return new Date(yr + 1911, parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        }
        m = dateStr.match(/^(\d{2,3})(\d{2})(\d{2})$/);
        if (m) {
            let yr = parseInt(m[1], 10);
            if (yr < 100) yr += 100;
            return new Date(yr + 1911, parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        }
        return null;
    }

    // 處置狀態判定邏輯
    function getDispositionStatus(periodStr) {
        if (!periodStr) return { text: "🔒 處置中", tag: "disposed" };
        
        let regex = /(\d{2,3}[/\.\-]\d{2}[/\.\-]\d{2})|(\d{6,7})/g;
        let dates = periodStr.match(regex);
        if (dates && dates.length >= 2) {
            let startDate = parseRocDateToDate(dates[0]);
            let endDate = parseRocDateToDate(dates[1]);
            if (startDate && endDate) {
                let today = new Date();
                today.setHours(0, 0, 0, 0);
                
                if (today < startDate) {
                    return { text: "⏳ 即將處置", tag: "upcoming" };
                }
                
                let diffTime = endDate.getTime() - today.getTime();
                let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays <= 1) {
                    return { text: "🔓 即將解禁", tag: "release" };
                }
                return { text: "🔒 處置中", tag: "disposed" };
            }
        }
        return { text: "🔒 處置中", tag: "disposed" };
    }

    // 從本地 JSON 載入數據
    async function loadData() {
        try {
            statusText.textContent = "正在載入預警數據...";
            // 讀取相對路徑的資料庫
            const response = await fetch('db/dashboard_data.json');
            if (!response.ok) {
                throw new Error("無法讀取 db/dashboard_data.json，請確認分析指令已執行。");
            }
            allStocks = await response.json();
            statusText.textContent = `載入成功。共有 ${allStocks.length} 檔連續注意與處置個股。`;
            applyFilters();
            
            // 預設選取第一筆注意股
            const firstRow = warningTbody.querySelector('tr[data-code]');
            if (firstRow) {
                firstRow.click();
            } else {
                const firstDispRow = disposedTbody.querySelector('tr[data-code]');
                if (firstDispRow) firstDispRow.click();
            }
        } catch (error) {
            console.error(error);
            statusText.textContent = `錯誤: ${error.message}`;
            warningTbody.innerHTML = `<tr><td colspan="7" class="placeholder-row">⚠️ 載入失敗: ${error.message}</td></tr>`;
            disposedTbody.innerHTML = `<tr><td colspan="6" class="placeholder-row">⚠️ 載入失敗: ${error.message}</td></tr>`;
        }
    }

    // 套用過濾器與搜尋
    function applyFilters() {
        const searchQuery = searchInput.value.trim().toUpperCase();
        const marketQuery = marketFilter.value;

        // 清空列表
        warningTbody.innerHTML = '';
        disposedTbody.innerHTML = '';

        filteredWarningStocks = [];
        filteredDisposedStocks = [];

        allStocks.forEach(stock => {
            const code = stock.Code || "";
            const name = stock.Name || "";
            const market = stock.Market || "";

            // 搜尋過濾
            if (searchQuery && !code.includes(searchQuery) && !name.includes(searchQuery)) {
                return;
            }
            // 市場過濾
            if (marketQuery !== "全部" && market !== marketQuery) {
                return;
            }

            const isDisposed = stock.IsDisposed || false;
            const disposedPeriod = stock.DisposedPeriod || "";
            
            let closeVal = stock.Close || "N/A";
            let closeStr = closeVal === "N/A" ? "N/A" : `${parseFloat(closeVal.replace(/,/g, '')).toFixed(2)} 元`;

            if (isDisposed) {
                filteredDisposedStocks.push(stock);
                const status = getDispositionStatus(disposedPeriod);
                
                const tr = document.createElement('tr');
                tr.setAttribute('data-code', code);
                tr.classList.add(`${status.tag}-row`);
                if (selectedStockCode === code) tr.classList.add('selected-row');

                tr.innerHTML = `
                    <td>${code}</td>
                    <td>${name}</td>
                    <td class="text-center">${market}</td>
                    <td class="text-right">${closeStr}</td>
                    <td>${disposedPeriod}</td>
                    <td class="text-center"><span class="status-badge ${status.tag}">${status.text}</span></td>
                `;
                
                tr.addEventListener('click', () => selectStock(stock, tr, 'disposed'));
                disposedTbody.appendChild(tr);
            } else {
                filteredWarningStocks.push(stock);
                
                // 尋找最易觸發價格距離
                let minAbsChange = 9999.0;
                let hasGuaranteedTrigger = false;
                const calcs = stock.Calculations || [];
                
                calcs.forEach(calc => {
                    const upChg = calc.TargetUpChange;
                    const downChg = calc.TargetDownChange;
                    const isPrimary = calc.IsPrimary || false;
                    
                    if (upChg !== null && upChg !== undefined) {
                        if (upChg >= -10.0 && upChg <= 10.0) {
                            let val = (upChg <= 0 && isPrimary) ? 0.0 : Math.abs(upChg);
                            minAbsChange = Math.min(minAbsChange, val);
                        } else if (upChg < -10.0 && isPrimary) {
                            hasGuaranteedTrigger = true;
                            minAbsChange = 0.0;
                        }
                    }
                    if (downChg !== null && downChg !== undefined) {
                        if (downChg >= -10.0 && downChg <= 10.0) {
                            let val = (downChg >= 0 && isPrimary) ? 0.0 : Math.abs(downChg);
                            minAbsChange = Math.min(minAbsChange, val);
                        } else if (downChg > 10.0 && isPrimary) {
                            hasGuaranteedTrigger = true;
                            minAbsChange = 0.0;
                        }
                    }
                });

                let tag = "normal";
                let statusText = "正常";
                if (hasGuaranteedTrigger) {
                    statusText = "🚨 必定觸發";
                    tag = "guaranteed";
                } else if (minAbsChange <= 1.0) {
                    statusText = "💥 極易觸發";
                    tag = "extreme";
                } else if (minAbsChange <= 5.0) {
                    statusText = "⚠️ 重點監控";
                    tag = "warn";
                }

                // 決定顯示的最易觸發價
                let triggerPriceStr = "無價格觸發";
                let primaryCalc = calcs.find(c => c.IsPrimary) || calcs[0];
                
                if (primaryCalc) {
                    const upP = primaryCalc.TargetUpPrice;
                    const upChg = primaryCalc.TargetUpChange;
                    const downP = primaryCalc.TargetDownPrice;
                    const downChg = primaryCalc.TargetDownChange;

                    let useUp = true;
                    if (upChg !== null && downChg !== null) {
                        let effUp = upChg <= 0 ? 0.0 : Math.abs(upChg);
                        let effDown = downChg >= 0 ? 0.0 : Math.abs(downChg);
                        if (effDown < effUp) useUp = false;
                    } else if (upChg === null && downChg !== null) {
                        useUp = false;
                    }

                    if (useUp && upP !== null && upChg !== null) {
                        if (upChg <= 0) {
                            triggerPriceStr = `已達標 (不跌破 ${upP.toFixed(2)})`;
                        } else if (upChg <= 10.0) {
                            triggerPriceStr = `${upP.toFixed(2)} 元 (${upChg > 0 ? '+' : ''}${upChg.toFixed(2)}%)`;
                        }
                    } else if (!useUp && downP !== null && downChg !== null) {
                        if (downChg >= 0) {
                            triggerPriceStr = `已達標 (不漲破 ${downP.toFixed(2)})`;
                        } else if (downChg >= -10.0) {
                            triggerPriceStr = `${downP.toFixed(2)} 元 (${downChg > 0 ? '+' : ''}${downChg.toFixed(2)}%)`;
                        }
                    }
                }

                // 推算今日成交張數 (從價格快取中尋找今日量)
                let volLots = "N/A";
                // 這裡僅留作空值，後續由 JS 或 PS 已經寫入的欄位來填充更佳。因網頁版無法直接存取 prices_cache.json（除非發起 fetch）
                // 為了效能，我們簡化顯示，或後續加載
                
                const tr = document.createElement('tr');
                tr.setAttribute('data-code', code);
                tr.classList.add(`${tag}-row`);
                if (selectedStockCode === code) tr.classList.add('selected-row');

                tr.innerHTML = `
                    <td>${code}</td>
                    <td>${name}</td>
                    <td class="text-center">${market}</td>
                    <td class="text-right">${closeStr}</td>
                    <td class="text-right" data-role="vol-placeholder">...張</td>
                    <td class="text-right">${triggerPriceStr}</td>
                    <td class="text-center"><span class="status-badge ${tag}">${statusText}</span></td>
                `;

                tr.addEventListener('click', () => selectStock(stock, tr, 'warning'));
                warningTbody.appendChild(tr);
            }
        });

        // 異步非同步抓取快取以填補成交量張數 (避免阻塞渲染)
        loadVolumes();

        // 填補空行提示
        if (warningTbody.children.length === 0) {
            warningTbody.innerHTML = `<tr><td colspan="7" class="placeholder-row">無符合篩選條件的預警股</td></tr>`;
        }
        if (disposedTbody.children.length === 0) {
            disposedTbody.innerHTML = `<tr><td colspan="6" class="placeholder-row">無符合篩選條件的處置股</td></tr>`;
        }

        // 更新統計卡片
        const numWarning = filteredWarningStocks.length;
        const numDisposed = filteredDisposedStocks.length;
        
        let numExtremeWarn = 0;
        filteredWarningStocks.forEach(stock => {
            let minAbs = 9999.0;
            let guaranteed = false;
            (stock.Calculations || []).forEach(calc => {
                const upChg = calc.TargetUpChange;
                const downChg = calc.TargetDownChange;
                const isPrimary = calc.IsPrimary || false;
                if (upChg !== null) {
                    if (upChg >= -10.0 && upChg <= 10.0) {
                        let val = (upChg <= 0 && isPrimary) ? 0.0 : Math.abs(upChg);
                        minAbs = Math.min(minAbs, val);
                    } else if (upChg < -10.0 && isPrimary) {
                        guaranteed = true;
                    }
                }
                if (downChg !== null) {
                    if (downChg >= -10.0 && downChg <= 10.0) {
                        let val = (downChg >= 0 && isPrimary) ? 0.0 : Math.abs(downChg);
                        minAbs = Math.min(minAbs, val);
                    } else if (downChg > 10.0 && isPrimary) {
                        guaranteed = true;
                    }
                }
            });
            if (guaranteed || minAbs <= 5.0) {
                numExtremeWarn++;
            }
        });

        countNotice.textContent = `${numWarning} 檔`;
        countWarn.textContent = `${numExtremeWarn} 檔`;
        countDisposed.textContent = `${numDisposed} 檔`;
    }

    // 異步加載成交量快取
    async function loadVolumes() {
        try {
            const response = await fetch('db/prices_cache.json');
            if (!response.ok) return;
            const cache = await response.json();
            
            // 更新 Warning 表格的成交量
            const rows = warningTbody.querySelectorAll('tr[data-code]');
            rows.forEach(row => {
                const code = row.getAttribute('data-code');
                const volCell = row.querySelector('[data-role="vol-placeholder"]');
                if (volCell && cache[code]) {
                    const prices = cache[code].prices || [];
                    if (prices.length > 0) {
                        const lastVol = prices[prices.length - 1].Volume || 0;
                        const lots = Math.round(lastVol / 1000);
                        volCell.textContent = `${lots.toLocaleString()} 張`;
                        volCell.removeAttribute('data-role');
                    }
                }
            });
        } catch(e) {
            console.warn("未下載或解析 prices_cache.json 成交量", e);
        }
    }

    // 選取股票並渲染右側詳細明細
    function selectStock(stock, trElement, tableType) {
        selectedStockCode = stock.Code;
        
        // 移除所有表格的選取狀態
        const allRows = document.querySelectorAll('tbody tr');
        allRows.forEach(r => r.classList.remove('selected-row'));
        
        // 將點擊行設為選取
        trElement.classList.add('selected-row');

        // 渲染詳細面版
        renderDetailCard(stock);

        // 如果是手機視圖 (寬度小於 1024px)，點選後平滑滾動到明細區塊
        if (window.innerWidth <= 1024) {
            detailSection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // 渲染詳細面板 HTML
    async function renderDetailCard(stock) {
        detailPlaceholder.classList.add('hidden');
        detailCard.classList.remove('hidden');

        const code = stock.Code || "";
        const name = stock.Name || "";
        const market = stock.Market || "";
        const close = stock.Close || "";
        const reason = stock.Reason || "";
        const isDisposed = stock.IsDisposed || false;
        
        let closePriceStr = close === "N/A" ? "N/A" : `${parseFloat(close.replace(/,/g, '')).toFixed(2)} 元`;

        if (isDisposed) {
            const disposedPeriod = stock.DisposedPeriod || "";
            const status = getDispositionStatus(disposedPeriod);
            
            let statusText = status.text;
            let statusClass = status.tag;
            
            let extraInfoHtml = "";
            let regex = /(\d{2,3}[/\.\-]\d{2}[/\.\-]\d{2})|(\d{6,7})/g;
            let dates = disposedPeriod.match(regex);
            if (dates && dates.length >= 2) {
                let startDate = parseRocDateToDate(dates[0]);
                let endDate = parseRocDateToDate(dates[1]);
                if (startDate && endDate) {
                    let today = new Date();
                    today.setHours(0,0,0,0);
                    if (today < startDate) {
                        let diff = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
                        extraInfoHtml = `<div class="status-badge upcoming" style="margin-top:5px; display:inline-block;">● 距離處置開始還有 ${diff} 天</div>`;
                    } else if (today <= endDate) {
                        let diff = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                        let alertHtml = diff <= 1 ? `<div class="status-badge release" style="margin-top:5px; display:inline-block;">📢 提醒：此有價證券即將於近日解禁，請密切關注！</div>` : "";
                        extraInfoHtml = `
                            <div class="status-badge disposed" style="margin-top:5px; display:inline-block;">● 處置執行中，距離解禁還有 ${diff} 天</div>
                            ${alertHtml}
                        `;
                    }
                }
            }

            detailCard.innerHTML = `
                <div>
                    <h2 class="detail-title">[${code}] ${name} (${market})</h2>
                    <p class="detail-subtitle">今日收盤價: <strong>${closePriceStr}</strong></p>
                </div>
                <div class="detail-divider"></div>
                <div class="detail-block">
                    <h3 class="detail-section-title">🔒 處置監控細節</h3>
                    <p class="detail-text">處置狀態: <span class="status-badge ${statusClass}">${statusText}</span></p>
                    <p class="detail-text">處置期間: <strong>${disposedPeriod}</strong></p>
                    ${extraInfoHtml}
                </div>
                <div class="detail-divider"></div>
                <div class="detail-block">
                    <h3 class="detail-section-title">📢 處置公告原因與措施</h3>
                    <p class="detail-text" style="white-space: pre-wrap; font-size: 0.85rem;">${reason.replace(/﹝/g, '[').replace(/﹞/g, ']')}</p>
                </div>
            `;
            return;
        }

        // --- 預警股詳細面板渲染 ---
        
        // 抓取成交量快取
        let volStr = "載入中...";
        try {
            const cacheResponse = await fetch('db/prices_cache.json');
            if (cacheResponse.ok) {
                const cache = await cacheResponse.json();
                if (cache[code] && cache[code].prices.length > 0) {
                    const lastVol = cache[code].prices[cache[code].prices.length - 1].Volume || 0;
                    volStr = `${lastVol.toLocaleString()} 股 (約 ${Math.round(lastVol/1000).toLocaleString()} 張)`;
                }
            }
        } catch(e) {
            volStr = "N/A (載入失敗)";
        }

        // 價格門檻 HTML 結構
        let priceHtml = '';
        const calcs = stock.Calculations || [];
        calcs.forEach(calc => {
            const rule = calc.Rule || "";
            const base = calc.BasePrice || 0;
            const upP = calc.TargetUpPrice || 0;
            const upChg = calc.TargetUpChange;
            const downP = calc.TargetDownPrice;
            const downChg = calc.TargetDownChange;
            const isPrimary = calc.IsPrimary || false;

            let upNote = '';
            let upClass = 'up-val';
            if (upChg > 10.0) {
                upNote = ' <span class="status-badge normal" style="padding: 1px 4px; font-size: 0.68rem;">超漲停限制 +10%</span>';
            } else if (upChg <= 0 && isPrimary) {
                upNote = ' <span class="status-badge guaranteed" style="padding: 1px 4px; font-size: 0.68rem;">🚨 必定觸發</span>';
                upClass = 'up-val guaranteed';
            } else if (upChg <= 5.0) {
                upNote = ' <span class="status-badge extreme" style="padding: 1px 4px; font-size: 0.68rem;">🔥 極易觸發</span>';
            }

            let downNote = '';
            let downClass = 'down-val';
            let downHtml = '';
            if (downP !== null && downChg !== null) {
                if (downChg < -10.0) {
                    downNote = ' <span class="status-badge normal" style="padding: 1px 4px; font-size: 0.68rem;">超跌停限制 -10%</span>';
                } else if (downChg >= 0 && isPrimary) {
                    downNote = ' <span class="status-badge guaranteed" style="padding: 1px 4px; font-size: 0.68rem;">🚨 必定觸發</span>';
                }
                downHtml = `<div class="${downClass}">▼ 看跌觸發價: <strong>${downP.toFixed(2)} 元</strong> (跌幅需求: ${downChg.toFixed(2)}%)${downNote}</div>`;
            }

            priceHtml += `
                <div class="threshold-row">
                    <div class="threshold-rule">${isPrimary ? '⭐ ' : '  '}${rule}</div>
                    <div style="font-size: 0.75rem; color: var(--fg-secondary); margin-bottom: 4px;">基準價: ${base.toFixed(2)} 元</div>
                    <div class="threshold-values">
                        <div class="${upClass}">▲ 看漲觸發價: <strong>${upP.toFixed(2)} 元</strong> (漲幅需求: ${upChg > 0 ? '+' : ''}${upChg.toFixed(2)}%)${upNote}</div>
                        ${downHtml}
                    </div>
                </div>
            `;
        });

        // 成交量門檻 HTML 結構
        let volumeHtml = '';
        const vCalcs = stock.VolumeCalculations || [];
        if (vCalcs.length > 0) {
            vCalcs.forEach(vCalc => {
                const rule = vCalc.Rule || "";
                const trigger = vCalc.TriggerVolume || 0;
                
                let trigText = '';
                if (trigger <= 0) {
                    trigText = '<strong class="vol-val">任意成交量皆會觸發！</strong> (今日已達標)';
                } else {
                    const lots = Math.round(trigger / 1000);
                    trigText = `觸發張數: <strong class="vol-val">${lots.toLocaleString()} 張</strong> (${parseInt(trigger).toLocaleString()} 股)`;
                }

                volumeHtml += `
                    <div class="threshold-row">
                        <div class="threshold-rule">${rule}</div>
                        <div class="threshold-values" style="font-size: 0.8rem;">
                            <div>${trigText}</div>
                        </div>
                    </div>
                `;
            });
        } else {
            volumeHtml = '<p class="detail-text" style="font-style: italic;">本檔個股查無歷史股數，僅推算 60日均量 5 倍保底門檻。</p>';
        }

        detailCard.innerHTML = `
            <div>
                <h2 class="detail-title">[${code}] ${name} (${market})</h2>
                <p class="detail-subtitle">今日收盤價: <strong>${closePriceStr}</strong> | 今日成交量: <span id="detail-vol-val">${volStr}</span></p>
            </div>
            <div class="detail-divider"></div>
            <div class="detail-block">
                <h3 class="detail-section-title">📢 今日公告注意原因</h3>
                <p class="detail-text" style="font-size: 0.85rem;">${reason.replace(/﹝/g, '[').replace(/﹞/g, ']')}</p>
            </div>
            <div class="detail-divider"></div>
            <div class="detail-block">
                <h3 class="detail-section-title">🎯 明日價格注意門檻 (收盤價預估)</h3>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${priceHtml}
                </div>
            </div>
            <div class="detail-divider"></div>
            <div class="detail-block">
                <h3 class="detail-section-title">⚡ 明日成交量注意門檻</h3>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${volumeHtml}
                </div>
            </div>
        `;
    }

    // 註冊搜尋與過濾事件監聽
    searchInput.addEventListener('input', applyFilters);
    marketFilter.addEventListener('change', applyFilters);

    // 啟動加載
    loadData();
});
