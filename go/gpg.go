package main

import (
//	"bufio"
//	"fmt"
	"bytes"
	"os"
	"strings"
	"encoding/json"
	"encoding/base64"
    "container/list"
	"os/exec"
)

type gpg_pubkey struct {
	Fingerprint string `json:"fingerprint"`
	Uid string `json:"uid"`
    Pubkey string `json:"pubkey,omitempty"`
}

type websocket_result struct {
    Communication string `json:"communication"`
    Error string `json:"error,omitempty"`
    GpgKeys []gpg_pubkey `json:"gpgkeys,omitempty"`
    Message string `json:"message,omitempty"`
    Signature string `json:"signature,omitempty"`
}

type websocket_command struct {
    Command string `json:"command"`
    Message string `json:"message,omitempty"`
    Fingerprint string `json: "fingerprint,omitempty"`
}

func gpg_sign_message(message string, fingerprint string, results chan <- websocket_result) {
	decoded, _ := base64.StdEncoding.DecodeString(message)
	tempfile, _ := os.CreateTemp("", "message-*")
	tempfile.Write(decoded)
	defer os.Remove(tempfile.Name())

	results <- websocket_result{
		Communication: "Signing process started. Please touch your Yubikey.",
	}

	command := exec.Command(
		"gpg",
		"--sign",
		"--detach-sign",
		"--armor",
		"--local-user",
		fingerprint,
		"--output",
		"-",
		"--no-tty",
		tempfile.Name(),
	)

	buf := new(bytes.Buffer)
	command.Stderr = buf

	result, err := command.Output()

	if err != nil {
		results <- websocket_result{
			Communication: "Signing failed",
			Error: buf.String(),
		}
		return
	}

	results <- websocket_result{
		Communication: "Message has been signed successfully.",
		Message: message,
		Signature: string(result),
	}
}

func gpg_getkeys() websocket_result {
	command := exec.Command("gpg", "--list-keys")
	output, keyerr := command.Output()

	if keyerr != nil {
		return websocket_result{
			Communication: "Failed to retrieve keys.",
			Error: string(output),
		}
	}

    lines := strings.Split(string(output), "\n")
	l := list.New()
   	var fingerprint = false
   	var pubkey gpg_pubkey

	for _, line := range lines {
        switch {
        	case fingerprint:
        		pubkey.Fingerprint = strings.Trim(line, " ")
        		fingerprint = false

				pkcommand := exec.Command(
					"gpg",
					"--export",
					"--armor",
					"--export-options",
					"export-minimal",
					pubkey.Fingerprint + "!",
				)
				pk, _ := pkcommand.Output()
				pubkey.Pubkey = string(pk)

        	case strings.HasPrefix(line, "pub "):
        	    fingerprint = true
        	   	pubkey = gpg_pubkey{}

        	case strings.HasPrefix(line, "uid "):
        		pubkey.Uid = strings.Trim(line[3:], " ")
        		l.PushBack(pubkey)
        }
	}

	var array = make([]gpg_pubkey, l.Len())
	var i int = 0

	for e := l.Front(); e != nil; e = e.Next() {
		array[i],_ = e.Value.(gpg_pubkey)
		i += 1
	}

	return websocket_result{
		Communication: "Keys retrieved.",
		GpgKeys: array,
	}
}


//func main() {
//	j,_ := json.Marshal( getkeys() )
//	fmt.Println( string(j) )
//}


func process_command(data []byte, results chan<- websocket_result) {
	var command websocket_command

	err := json.Unmarshal(data, &command)

	if err != nil {
		results <- websocket_result{
			Communication: "Invalid payload.",
		}
		return
	}

	switch command.Command {
		case "sign":
            gpg_sign_message(command.Message, command.Fingerprint, results)
            return
		case "getkeys":
            results <- gpg_getkeys()
            return
		default:
			results <- websocket_result{
				Communication: "Unknown command.",
			}
			return
	}
}
