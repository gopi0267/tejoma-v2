{{- define "jd-parser-service.name" -}}
jd-parser-service
{{- end -}}

{{- define "jd-parser-service.fullname" -}}
{{- .Release.Name -}}-jd-parser-service
{{- end -}}

{{- define "jd-parser-service.labels" -}}
app.kubernetes.io/name: {{ include "jd-parser-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "jd-parser-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jd-parser-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "jd-parser-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "jd-parser-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "jd-parser-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "jd-parser-service.fullname" .)) -}}
{{- end -}}
