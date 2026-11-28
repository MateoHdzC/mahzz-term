[ -n "$MAHZZ_RC" ] && rm -f "$MAHZZ_RC"
unset MAHZZ_RC

[ -f /etc/profile ] && . /etc/profile
if [ -f ~/.bash_profile ]; then . ~/.bash_profile
elif [ -f ~/.bash_login ]; then . ~/.bash_login
elif [ -f ~/.profile ]; then . ~/.profile
elif [ -f ~/.bashrc ]; then . ~/.bashrc
fi

__mahzz_b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
__mahzz_marca() { printf '\033]133;%s\007' "$1"; }

__mahzz_rama() {
  local d=$PWD h
  while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then
      h=$d/.git/HEAD
      if [ -f "$d/.git" ]; then
        h=$(sed 's/^gitdir: //' "$d/.git")
        case $h in /*) ;; *) h=$d/$h ;; esac
        h=$h/HEAD
      fi
      [ -r "$h" ] || return
      read -r h < "$h"
      case $h in
        "ref: refs/heads/"*) printf '%s' "${h#ref: refs/heads/}" ;;
        *) printf '%.7s' "$h" ;;
      esac
      return
    fi
    d=${d%/*}
  done
}

__mahzz_prompt() {
  local codigo=$?
  __mahzz_marca "rd;$codigo"
  printf '\033[2J\033[3J\033[H'
  __mahzz_marca "rw;$(__mahzz_b64 "$PWD")"
  __mahzz_marca "ra;$(__mahzz_b64 "$(__mahzz_rama)")"
}

__mahzz_e() {
  local __mahzz_comando
  __mahzz_comando=$(printf '%s' "$1" | base64 -d)
  __mahzz_marca "rc;$1"
  history -s "$__mahzz_comando"
  eval "$__mahzz_comando"
}

HISTCONTROL=ignoreboth
PS1=
PS2=
PROMPT_COMMAND=__mahzz_prompt
bind 'set enable-bracketed-paste off' 2>/dev/null
__mahzz_marca "rh;$(__mahzz_b64 "${USER:-$(id -un)}@$(hostname)")"
