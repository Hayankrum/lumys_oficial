const MENSAGEM_CONEXAO = 'Não foi possível conectar. Verifique sua internet e tente novamente.'

const TEXTO_TECNICO = /network ?error|failed to fetch|fetch failed|load failed|networkrequestfailed|typeerror|econn|enotfound|etimedout|timeout|aborted|aborterror|quota|unknown|undefined is not|cannot read/i

function textoAmigavel(mensagem) {
  const texto = typeof mensagem === 'string' ? mensagem.trim() : ''
  return texto && !TEXTO_TECNICO.test(texto) ? texto : ''
}

export function mensagemDeErro(error, fallback = 'Não foi possível concluir a operação. Tente novamente.') {
  if (!error) return fallback
  if (typeof error === 'string') return textoAmigavel(error) || fallback

  if (error.name === 'NotAllowedError') return 'Permissão negada. Autorize o acesso e tente novamente.'
  if (error.name === 'NotFoundError') return 'Nenhum dispositivo foi encontrado. Tente novamente.'
  if (error.name === 'NotReadableError') return 'O dispositivo está em uso por outro aplicativo. Feche-o e tente novamente.'

  const status = error.status
  const mensagem = textoAmigavel(error.message)

  if (status === 401) return 'Sua sessão expirou. Entre novamente.'
  if (status === 403) return mensagem || 'Você não tem permissão para acessar este conteúdo.'
  if (status === 404) return mensagem || 'Não encontramos o que você procura. Talvez tenha sido removido.'
  if (status === 409) return mensagem || 'Os dados foram alterados em outro dispositivo. Atualize e tente novamente.'
  if (status === 429) return 'Muitas tentativas. Aguarde um instante e tente novamente.'
  if (typeof status === 'number' && status >= 500) {
    return 'O servidor não conseguiu concluir a operação. Tente novamente em instantes.'
  }
  if (typeof status === 'number') return mensagem || fallback

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Você está offline. Verifique sua conexão e tente novamente.'
  }
  return mensagem || (error instanceof TypeError ? MENSAGEM_CONEXAO : fallback)
}
