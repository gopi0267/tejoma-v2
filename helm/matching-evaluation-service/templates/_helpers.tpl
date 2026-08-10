{{- define "matching-evaluation-service.name" -}}
matching-evaluation-service
{{- end -}}

{{- define "matching-evaluation-service.fullname" -}}
{{- .Release.Name -}}-matching-evaluation-service
{{- end -}}

{{- define "matching-evaluation-service.labels" -}}
app.kubernetes.io/name: {{ include "matching-evaluation-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "matching-evaluation-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "matching-evaluation-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "matching-evaluation-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "matching-evaluation-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "matching-evaluation-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "matching-evaluation-service.fullname" .)) -}}
{{- end -}}
