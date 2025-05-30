import { useState, useEffect, useRef } from 'react';
import './App.css';

interface SvgExport {
  name: string;
  data: string;
}

const ENCRYPTION_KEY = 'shopl-icon-automation-2024';

function App() {
  const [svgExports, setSvgExports] = useState<SvgExport[]>([]);
  const [githubToken, setGithubToken] = useState('');
  const [saveToken, setSaveToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [logs, setLogs] = useState<{ message: string; type: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // 암호화 함수
  const encrypt = (text: string) => {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return btoa(result);
  };

  // 복호화 함수
  const decrypt = (encryptedText: string) => {
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

  // 로그 메시지 추가
  const log = (message: string, type: string = '') => {
    setLogs((prev) => [...prev, { message, type }]);
  };

  // 토큰 저장/불러오기
  useEffect(() => {
    parent.postMessage({ pluginMessage: { type: 'get-token' } }, '*');
  }, []);

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

  // 메시지 수신 처리
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const msg = event.data.pluginMessage;

      if (msg.type === 'svg-exports') {
        const validIcons = msg.data.filter((icon: SvgExport) => {
          const fileName = icon.name.split('/').pop();
          if (!fileName?.toLowerCase().includes('ic')) {
            log(`경고: ${fileName} - 아이콘 이름에 'ic'가 포함되어 있지 않아 내보내기가 제외되었습니다.`, 'error');
            return false;
          }
          return true;
        });

        if (validIcons.length === 0) {
          log('오류: 내보내기 가능한 아이콘이 없습니다. 아이콘 이름에 "ic"가 포함되어야 합니다.', 'error');
          return;
        }

        setSvgExports(validIcons);
        log(`${validIcons.length}개의 아이콘이 정상적으로 내보내기 되었습니다.`, 'success');
        await pushToGitHub();
      } else if (msg.type === 'error') {
        log(msg.message, 'error');
      } else if (msg.type === 'token-loaded') {
        if (msg.token) {
          const decryptedToken = decrypt(msg.token);
          if (decryptedToken) {
            setGithubToken(decryptedToken);
            setSaveToken(true);
          }
        }
      } else if (msg.type === 'delete-names') {
        for (const iconName of msg.data) {
          await deleteFile(iconName);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // GitHub 관련 함수들
  const createBranch = async (token: string) => {
    try {
      log('main 브랜치 정보 가져오는 중...');
      const mainRefResponse = await fetch('https://api.github.com/repos/shopl/shoplflow/git/refs/heads/main', {
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!mainRefResponse.ok) {
        const error = await mainRefResponse.json();
        log(`main 브랜치 정보 가져오기 실패: ${JSON.stringify(error)}`, 'error');
        throw new Error(`main 브랜치 정보 가져오기 실패: ${mainRefResponse.statusText}`);
      }

      const mainRef = await mainRefResponse.json();
      const mainSha = mainRef.object.sha;
      log(`main 브랜치 SHA: ${mainSha}`, 'success');

      log('새 브랜치 생성 중...');
      const response = await fetch('https://api.github.com/repos/shopl/shoplflow/git/refs', {
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
          log('브랜치가 이미 존재합니다. 해당 브랜치를 사용합니다.', 'info');
          return true;
        }
        log(`브랜치 생성 실패: ${error.message}`, 'error');
        throw new Error(`브랜치 생성 실패: ${response.statusText}`);
      }

      const result = await response.json();
      log(`브랜치 생성 성공: ${JSON.stringify(result)}`, 'success');
      return true;
    } catch (error) {
      log(`브랜치 생성 상세 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
      throw error;
    }
  };

  const uploadFile = async (token: string, item: SvgExport) => {
    const fileName = item.name.split('/').pop();
    const prefix = item.name.split('/')[0];
    const path = `packages/${prefix}-assets/src/icons/assets/${fileName}.svg`;
    const content = btoa(unescape(encodeURIComponent(item.data)));

    const getResponse = await fetch(`https://api.github.com/repos/shopl/shoplflow/contents/${path}?ref=update/icon`, {
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    let sha = null;
    if (getResponse.ok) {
      const fileInfo = await getResponse.json();
      sha = fileInfo.sha;
    }

    const response = await fetch(`https://api.github.com/repos/shopl/shoplflow/contents/${path}`, {
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
        ...(sha && { sha: sha }),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`파일 업로드 실패: ${error.message}`);
    }
  };

  const pushToGitHub = async () => {
    try {
      log('GitHub에 파일 업로드 중...');
      for (const item of svgExports) {
        await uploadFile(githubToken, item);
      }
      log('GitHub 파일 업로드 완료', 'success');
      log('GitHub Actions가 자동으로 실행됩니다...', 'info');
    } catch (error) {
      log(`GitHub 업로드 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const deleteFile = async (iconName: string) => {
    const prefix = iconName.split('/')[0];
    const fileName = iconName.split('/').pop();
    const path = `packages/${prefix}-assets/src/icons/assets/${fileName}.svg`;

    const getResponse = await fetch(`https://api.github.com/repos/shopl/shoplflow/contents/${path}?ref=update/icon`, {
      headers: {
        Authorization: `token ${githubToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!getResponse.ok) {
      log(`삭제 실패: 파일을 찾을 수 없습니다. (${path})`, 'error');
      return;
    }

    const fileInfo = await getResponse.json();
    const sha = fileInfo.sha;

    const response = await fetch(`https://api.github.com/repos/shopl/shoplflow/contents/${path}`, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${githubToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        message: 'icon 삭제',
        sha: sha,
        branch: 'update/icon',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      log(`삭제 실패: ${error.message}`, 'error');
      return;
    }

    log(`${iconName} 아이콘이 성공적으로 삭제되었습니다.`, 'success');
  };

  const handleExport = async () => {
    try {
      if (!githubToken) {
        log('GitHub 토큰을 입력해주세요.', 'error');
        return;
      }

      setLogs([]);
      setIsLoading(true);
      log('브랜치 생성 시작...');
      await createBranch(githubToken);
      log('브랜치 생성 완료', 'success');

      log('아이콘 내보내기 시작...');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'export-svg',
            data: {
              path: 'packages/shopl-assets/src/icons/assets',
            },
          },
        },
        '*',
      );
    } catch (error) {
      log(`오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      if (!githubToken) {
        log('GitHub 토큰을 입력해주세요.', 'error');
        return;
      }
      parent.postMessage({ pluginMessage: { type: 'delete-svg' } }, '*');
    } catch (error) {
      log(`삭제 오류: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className='container'>
      <h2>Shoplcon</h2>

      <div className='input-group'>
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
              <>
                <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'></path>
                <circle cx='12' cy='12' r='3'></circle>
              </>
            )}
          </svg>
        </button>
        <div className='token-info'>토큰은 GitHub에서 발급받을 수 있습니다. 저장된 토큰은 로컬에만 저장됩니다.</div>
        <div className='checkbox-group'>
          <input type='checkbox' id='saveToken' checked={saveToken} onChange={(e) => setSaveToken(e.target.checked)} />
          <label htmlFor='saveToken'>토큰 저장하기</label>
        </div>
      </div>

      <button
        id='exportButton'
        disabled={!githubToken || isLoading}
        onClick={handleExport}
        style={{ marginBottom: '12px' }}
      >
        {isLoading && <span className='loading'></span>}
        아이콘 내보내기 및 PR 생성
      </button>

      <div className='delete-group' style={{ marginBottom: '12px' }}>
        <button id='deleteButton' onClick={handleDelete} disabled={!githubToken}>
          아이콘 삭제
        </button>
      </div>

      <div className='output' ref={outputRef}>
        {logs.length === 0 ? (
          <p className='info'>로그 메시지가 여기에 표시됩니다.</p>
        ) : (
          logs.map((log, index) => (
            <p key={index} className={log.type}>
              {log.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
