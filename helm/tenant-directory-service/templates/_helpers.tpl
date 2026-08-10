{{- define "tenant-directory-service.name" -}}
tenant-directory-service
{{- end -}}

{{- define "tenant-directory-service.fullname" -}}
{{- .Release.Name -}}-tenant-directory-service
{{- end -}}

{{- define "tenant-directory-service.labels" -}}
app.kubernetes.io/name: {{ include "tenant-directory-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
tejoma.io/tier: tier-0
{{- end -}}

{{- define "tenant-directory-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tenant-directory-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "tenant-directory-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "tenant-directory-service.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}

{{- define "tenant-directory-service.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "tenant-directory-service.fullname" .)) -}}
{{- end -}}
