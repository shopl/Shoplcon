import { useState, useEffect, useRef } from 'react';
import './App.css';

interface SvgExport {
  name: string;
  data: string;
}

interface LogMessage {
  message: string;
  type: string;
}

const ENCRYPTION_KEY = 'shopl-icon-automation-2024';

function App() {
  const [svgExports, setSvgExports] = useState<SvgExport[]>([]);
  const [githubToken, setGithubToken] = useState('');
  const [saveToken, setSaveToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [platform, setPlatform] = useState('web');
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  console.log('platform : ', platform);

  const outputRef = useRef<HTMLDivElement>(null);

  // 토큰 암호화/복호화 함수들
  const encrypt = (text: string): string => {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return btoa(result);
  };

  const decrypt = (encryptedText: string): string | null => {
    try {
      const decoded = atob(encryptedText);
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
        result += String.fromCharCode(charCode);
      }
      return result;
    } catch (error) {
      console.error('복호화 실패:', error);
      return null;
    }
  };

  // 로그 메시지 추가 함수
  const addLog = (message: string, type: string = '') => {
    setLogs((prev) => [...prev, { message, type }]);
  };

  // 토큰 저장/불러오기
  useEffect(() => {
    if (saveToken && githubToken) {
      const encryptedToken = encrypt(githubToken);
      parent.postMessage(
        {
          pluginMessage: {
            type: 'set-token',
            token: encryptedToken,
          },
        },
        '*',
      );
    } else if (!saveToken) {
      parent.postMessage(
        {
          pluginMessage: {
            type: 'delete-token',
          },
        },
        '*',
      );
    }
  }, [saveToken, githubToken]);

  // 초기 토큰 로드
  useEffect(() => {
    parent.postMessage(
      {
        pluginMessage: {
          type: 'get-token',
        },
      },
      '*',
    );
  }, []);

  // 메시지 핸들러
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const msg = event.data.pluginMessage;

      if (msg.type === 'svg-exports') {
        const validIcons = msg.data.filter((icon: SvgExport) => {
          const fileName = icon.name.split('/').pop()?.trim();
          if (!fileName?.toLowerCase().includes('ic')) {
            addLog(`경고: ${fileName} - 아이콘 이름에 'ic'가 포함되어 있지 않아 내보내기가 제외되었습니다.`, 'error');
            return false;
          }
          return true;
        });

        if (validIcons.length === 0) {
          addLog('오류: 내보내기 가능한 아이콘이 없습니다. 아이콘 이름에 "ic"가 포함되어야 합니다.', 'error');
          return;
        }

        setSvgExports(validIcons);
        addLog(`${validIcons.length}개의 아이콘이 정상적으로 내보내기 되었습니다.`, 'success');
        await pushToGitHub();
      } else if (msg.type === 'error') {
        addLog(msg.message, 'error');
      } else if (msg.type === 'token-loaded') {
        if (msg.token) {
          const decryptedToken = decrypt(msg.token);
          if (decryptedToken) {
            setGithubToken(decryptedToken);
            setSaveToken(true);
          }
        }
      } else if (msg.type === 'selection-changed') {
        setCanDelete(msg.icCount > 0);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // GitHub 관련 함수들
  const createBranch = async (token: string) => {
    try {
      const repo = platform === 'web' ? 'shopl/shoplflow' : 'shopl/shopl-design-guide-android';
      addLog('main 브랜치 정보 가져오는 중...');

      const mainRefResponse = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/main`, {
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!mainRefResponse.ok) {
        throw new Error(`main 브랜치 정보 가져오기 실패: ${mainRefResponse.statusText}`);
      }

      const mainRef = await mainRefResponse.json();
      const mainSha = mainRef.object.sha;
      addLog(`main 브랜치 SHA: ${mainSha}`, 'success');

      addLog('새 브랜치 생성 중...');
      const response = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          ref: 'refs/heads/update/icon',
          sha: mainSha,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.message?.includes('Reference already exists')) {
          addLog('브랜치가 이미 존재합니다. 해당 브랜치를 사용합니다.', 'info');
          return true;
        }
        throw new Error(`브랜치 생성 실패: ${response.statusText}`);
      }

      const result = await response.json();
      addLog(`브랜치 생성 성공: ${JSON.stringify(result)}`, 'success');
      return true;
    } catch (error) {
      addLog(`브랜치 생성 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
      throw error;
    }
  };

  const pushToGitHub = async () => {
    try {
      const token = githubToken;
      const repo = platform === 'web' ? 'shopl/shoplflow' : 'shopl/shopl-design-guide-android';
      addLog('GitHub에 파일 업로드 중...');
      let allSuccess = true;

      for (const item of svgExports) {
        const result = await uploadFile(token, item, repo);
        if (!result) allSuccess = false;
      }

      if (allSuccess) {
        addLog('GitHub 파일 업로드 완료', 'success');
        addLog('GitHub Actions가 자동으로 실행됩니다...', 'info');
      }
    } catch (error) {
      addLog(`GitHub 업로드 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const uploadFile = async (token: string, item: SvgExport, repo: string) => {
    const fileName = item.name.split('/').pop()?.trim();
    const prefix = item.name.split('/')[0];
    let path: string;
    let content: string;
    const isMobile = platform === 'mobile';
    const isWebPrefix = prefix?.startsWith('shopl') || prefix?.startsWith('hada');

    if (isMobile && isWebPrefix) {
      addLog(`${fileName} 아이콘은 모바일 플랫폼에서 업로드할 수 없습니다. (prefix: ${prefix})`, 'error');
      return false;
    }
    if (!isMobile && !isWebPrefix) {
      addLog(`${fileName} 아이콘은 웹 플랫폼에서만 업로드할 수 있습니다. (prefix: ${prefix})`, 'error');
      return false;
    }

    if (isMobile) {
      const xml = svgToVectorDrawable(item.data);
      if (!xml) {
        addLog(`${fileName} 변환 실패: 지원하지 않는 SVG입니다.`, 'error');
        return false;
      }
      path = `sdg-resource/src/main/res/drawable/${fileName}.xml`;
      content = btoa(unescape(encodeURIComponent(xml)));
    } else {
      path = `packages/${prefix}-assets/src/icons/assets/${fileName}.svg`;
      content = btoa(unescape(encodeURIComponent(item.data)));
    }

    try {
      const getResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=update/icon`, {
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
      });

      let sha: string | null = null;
      if (getResponse.ok) {
        const fileInfo = await getResponse.json();
        sha = fileInfo.sha;
      }

      const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          message: 'icon 추가/업데이트',
          content: content,
          branch: 'update/icon',
          ...(sha && { sha }),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`파일 업로드 실패: ${error.message}`);
      }
      return true;
    } catch (error) {
      addLog(`파일 업로드 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return false;
    }
  };

  const svgToVectorDrawable = (svgString: string): string | null => {
    try {
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
      const svg = svgDoc.querySelector('svg');

      if (!svg) {
        throw new Error('SVG 태그가 없습니다.');
      }

      let width = svg.getAttribute('width') || '24';
      let height = svg.getAttribute('height') || '24';
      const viewBox = svg.getAttribute('viewBox') || `0 0 ${width} ${height}`;

      width = width.toString().replace(/[^\d.]/g, '');
      height = height.toString().replace(/[^\d.]/g, '');

      const viewBoxValues = viewBox.split(/\s+/);
      const viewportWidth = viewBoxValues[2] || width;
      const viewportHeight = viewBoxValues[3] || height;

      const elements = svg.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon');

      if (elements.length === 0) {
        throw new Error('변환 가능한 그래픽 요소가 없습니다.');
      }

      let vectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${width}dp"
    android:height="${height}dp"
    android:viewportWidth="${viewportWidth}"
    android:viewportHeight="${viewportHeight}">`;

      for (const element of elements) {
        const pathData = convertElementToPath(element);
        if (!pathData) continue;

        const fill =
          element.getAttribute('fill') || element.getAttribute('style')?.match(/fill:\s*([^;]+)/)?.[1] || '#000000';
        const stroke = element.getAttribute('stroke') || element.getAttribute('style')?.match(/stroke:\s*([^;]+)/)?.[1];
        const strokeWidth =
          element.getAttribute('stroke-width') || element.getAttribute('style')?.match(/stroke-width:\s*([^;]+)/)?.[1];
        const fillRule =
          element.getAttribute('fill-rule') || element.getAttribute('style')?.match(/fill-rule:\s*([^;]+)/)?.[1];
        const fillType = fillRule === 'evenodd' ? 'evenOdd' : 'nonZero';

        vectorXml += '\n  <path';
        vectorXml += `\n      android:pathData="${pathData}"`;

        if (fill && fill !== 'none' && fill !== 'transparent') {
          const hexColor = convertColorToHex(fill);
          vectorXml += `\n      android:fillColor="${hexColor}"`;
          vectorXml += `\n      android:fillType="${fillType}"`;
        }

        if (stroke && stroke !== 'none' && stroke !== 'transparent') {
          const hexStroke = convertColorToHex(stroke);
          vectorXml += `\n      android:strokeColor="${hexStroke}"`;
          if (strokeWidth) {
            vectorXml += `\n      android:strokeWidth="${parseFloat(strokeWidth)}"`;
          }
        }

        vectorXml += '/>';
      }

      vectorXml += '\n</vector>';
      return vectorXml;
    } catch (error) {
      console.error('SVG 변환 오류:', error);
      return null;
    }
  };

  const convertElementToPath = (element: Element): string | null => {
    const tagName = element.tagName.toLowerCase();

    switch (tagName) {
      case 'path':
        return element.getAttribute('d');
      case 'circle': {
        const cx = parseFloat(element.getAttribute('cx') || '0');
        const cy = parseFloat(element.getAttribute('cy') || '0');
        const r = parseFloat(element.getAttribute('r') || '0');
        return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`;
      }
      case 'rect': {
        const x = parseFloat(element.getAttribute('x') || '0');
        const y = parseFloat(element.getAttribute('y') || '0');
        const w = parseFloat(element.getAttribute('width') || '0');
        const h = parseFloat(element.getAttribute('height') || '0');
        const rx = parseFloat(element.getAttribute('rx') || '0');
        const ry = parseFloat(element.getAttribute('ry') || rx.toString());

        if (rx > 0 || ry > 0) {
          return `M ${x + rx} ${y} L ${x + w - rx} ${y} Q ${x + w} ${y} ${x + w} ${y + ry} L ${x + w} ${y + h - ry} Q ${x + w} ${y + h} ${x + w - rx} ${y + h} L ${x + rx} ${y + h} Q ${x} ${y + h} ${x} ${y + h - ry} L ${x} ${y + ry} Q ${x} ${y} ${x + rx} ${y} Z`;
        }
        return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
      }
      case 'ellipse': {
        const ecx = parseFloat(element.getAttribute('cx') || '0');
        const ecy = parseFloat(element.getAttribute('cy') || '0');
        const erx = parseFloat(element.getAttribute('rx') || '0');
        const ery = parseFloat(element.getAttribute('ry') || '0');
        return `M ${ecx - erx} ${ecy} A ${erx} ${ery} 0 1 0 ${ecx + erx} ${ecy} A ${erx} ${ery} 0 1 0 ${ecx - erx} ${ecy}`;
      }
      case 'line': {
        const x1 = parseFloat(element.getAttribute('x1') || '0');
        const y1 = parseFloat(element.getAttribute('y1') || '0');
        const x2 = parseFloat(element.getAttribute('x2') || '0');
        const y2 = parseFloat(element.getAttribute('y2') || '0');
        return `M ${x1} ${y1} L ${x2} ${y2}`;
      }
      case 'polyline':
      case 'polygon': {
        const points = element.getAttribute('points') || '';
        const coords = points
          .trim()
          .split(/[\s,]+/)
          .filter((p) => p);
        if (coords.length < 4) return null;

        let pathData = `M ${coords[0]} ${coords[1]}`;
        for (let i = 2; i < coords.length; i += 2) {
          if (coords[i + 1]) {
            pathData += ` L ${coords[i]} ${coords[i + 1]}`;
          }
        }
        if (tagName === 'polygon') {
          pathData += ' Z';
        }
        return pathData;
      }
      default:
        return null;
    }
  };

  const convertColorToHex = (color: string): string => {
    if (!color || color === 'none' || color === 'transparent') {
      return '#00000000';
    }

    if (color.startsWith('#')) {
      return color.length === 4 ? '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] : color;
    }

    const rgbMatch = color.match(/rgba?\(([^)]+)\)/);
    if (rgbMatch) {
      const values = rgbMatch[1].split(',').map((v) => parseFloat(v.trim()));
      const r = Math.round(values[0]).toString(16).padStart(2, '0');
      const g = Math.round(values[1]).toString(16).padStart(2, '0');
      const b = Math.round(values[2]).toString(16).padStart(2, '0');
      const a =
        values[3] !== undefined
          ? Math.round(values[3] * 255)
              .toString(16)
              .padStart(2, '0')
          : 'ff';
      return `#${a}${r}${g}${b}`;
    }

    const colorMap: Record<string, string> = {
      black: '#000000',
      white: '#ffffff',
      red: '#ff0000',
      green: '#008000',
      blue: '#0000ff',
      yellow: '#ffff00',
      cyan: '#00ffff',
      magenta: '#ff00ff',
      gray: '#808080',
      grey: '#808080',
    };

    return colorMap[color.toLowerCase()] || '#000000';
  };

  const handleExport = async () => {
    try {
      if (!githubToken) {
        addLog('GitHub 토큰을 입력해주세요.', 'error');
        return;
      }
      setIsLoading(true);
      setLogs([]);
      addLog('브랜치 생성 시작...');
      await createBranch(githubToken);
      addLog('브랜치 생성 완료', 'success');
      addLog('아이콘 내보내기 시작...');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'export-svg',
            data: {
              path:
                platform === 'web' ? 'packages/shopl-assets/src/icons/assets' : 'sdg-resource/src/main/res/drawable',
            },
          },
        },
        '*',
      );
    } catch (error) {
      addLog(`오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      if (!githubToken) {
        addLog('GitHub 토큰을 입력해주세요.', 'error');
        return;
      }
      parent.postMessage({ pluginMessage: { type: 'delete-svg' } }, '*');
    } catch (error) {
      addLog(`삭제 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className='container'>
      <h2>Shoplcon</h2>

      <div className='input-group'>
        <label htmlFor='platformSelect'>대상 플랫폼</label>
        <select id='platformSelect' value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value='web'>웹</option>
          <option value='mobile'>모바일</option>
        </select>
      </div>

      <div className='input-group' style={{ width: '400px' }}>
        <label htmlFor='githubToken'>GitHub Personal Access Token</label>
        <input
          id='githubToken'
          type={showToken ? 'text' : 'password'}
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder='ghp_...'
          autoComplete='off'
        />
        <button
          type='button'
          className='token-toggle'
          onClick={() => setShowToken(!showToken)}
          title='토큰 보이기/숨기기'
        >
          <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
            {showToken ? (
              <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'></path>
            ) : (
              <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'></path>
            )}
            <circle cx='12' cy='12' r='3'></circle>
          </svg>
        </button>
        <div className='token-info'>토큰은 GitHub에서 발급받을 수 있습니다. 저장된 토큰은 로컬에만 저장됩니다.</div>
        <div className='checkbox-group'>
          <input type='checkbox' id='saveToken' checked={saveToken} onChange={(e) => setSaveToken(e.target.checked)} />
          <label htmlFor='saveToken'>토큰 저장하기</label>
        </div>
      </div>

      <button id='exportButton' disabled={!githubToken} onClick={handleExport} style={{ marginBottom: '12px' }}>
        {isLoading && <span className='loading'></span>}
        아이콘 내보내기 및 PR 생성
      </button>

      <div className='delete-group' style={{ marginBottom: '12px' }}>
        <button
          id='deleteButton'
          disabled={!canDelete}
          onClick={handleDelete}
          style={{ marginTop: 0, marginBottom: 0, transition: 'background 0.2s', width: '100%' }}
        >
          아이콘 삭제
        </button>
      </div>

      <div className='output' ref={outputRef}>
        {logs.map((log, index) => (
          <p key={index} className={log.type}>
            {log.message}
          </p>
        ))}
      </div>
    </div>
  );
}

export default App;
